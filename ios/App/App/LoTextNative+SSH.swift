// Connect to Server on iPhone and iPad (src/mobile/ssh-transport.js): SSH inside the app, since
// iOS has no `ssh` to run. The Mac's remote folder is `/usr/bin/ssh`; this is the same thing
// done with Apple's SwiftNIO SSH, so the shared store above it (src/shared/store/remote-store.js)
// cannot tell them apart.
//
//   sshPublicKey   this device's key, as the one line for a server's `authorized_keys`
//   sshRun         one command on a server: its exit status, its output and what it printed
//                  on stderr — with bytes fed to its stdin first when there are any
//   sshClose       hangs up the connection to one server
//
// **The device has its own key, and only it.** An Ed25519 key made on first use and kept in the
// keychain as this-device-only, so it never leaves the phone — not in a backup, not to iCloud.
// The user adds its public line to a server once, the way they would for any other machine.
//
// **First contact is trusted; a key that changes is refused** — the Mac's `accept-new`. The
// servers' keys are kept in Application Support/LoText/ssh-known-hosts.json.
//
// **Encryption is the operating system's**: every cipher, key exchange, signature and hash here
// is CryptoKit (swift-crypto re-exports it on iOS). That is what lets the app tell App Store
// Connect it uses only the OS's encryption (ITSAppUsesNonExemptEncryption = NO); a package that
// brings its own crypto would end that (packaging/app-store/ios.md).
//
// One connection per server, held open and shared by every command, the way the Mac's
// multiplexed master is; a command on a connection that has dropped opens a new one.

import Foundation
import Capacitor
import CryptoKit
import NIOCore
import NIOPosix
import NIOSSH

extension LoTextNativePlugin {
    @objc func sshPublicKey(_ call: CAPPluginCall) {
        do {
            call.resolve(["key": try SSHKey.publicLine(device: call.getString("device") ?? "iPhone")])
        } catch {
            call.reject(error.localizedDescription, "failed")
        }
    }

    @objc func sshRun(_ call: CAPPluginCall) {
        guard let server = SSHServer(call) else { call.reject("No server was named.", "failed"); return }
        guard let command = call.getString("command") else { call.reject("No command was sent.", "failed"); return }
        var input: Data?
        if let encoded = call.getString("input") {
            guard let data = Data(base64Encoded: encoded) else { call.reject("The bytes to send could not be read.", "failed"); return }
            input = data
        }
        let timeout = TimeAmount.milliseconds(Int64(call.getInt("timeout") ?? 30000))

        SSHConnections.shared.run(command, on: server, input: input, timeout: timeout).whenComplete { result in
            switch result {
            case .success(let answer):
                call.resolve([
                    "status": answer.status,
                    "output": answer.output.base64EncodedString(),
                    "diagnostic": answer.diagnostic,
                ])
            case .failure(let error):
                let failure = SSHFailure(error)
                call.reject(failure.message, failure.code)
            }
        }
    }

    @objc func sshClose(_ call: CAPPluginCall) {
        if let server = SSHServer(call) { SSHConnections.shared.close(server) }
        call.resolve()
    }
}

// MARK: - The server

/** Who to log in as and where: the native half of src/shared/store/remote-location.js. */
struct SSHServer: Hashable {
    let user: String
    let host: String
    let port: Int

    init?(_ call: CAPPluginCall) {
        guard let host = call.getString("host"), !host.isEmpty else { return nil }
        self.host = host
        self.port = call.getInt("port") ?? 22
        // `ssh` logs in as whoever you are here when no user is given; a phone has no such
        // person, so the address has to name one.
        self.user = call.getString("user") ?? ""
    }

    /** How the known-hosts file names it: OpenSSH's `[host]:port`, plain `host` on 22. */
    var knownHostsName: String { port == 22 ? host : "[\(host)]:\(port)" }
}

// MARK: - The device's key

enum SSHKey {
    private static let account = "LoText SSH key"
    private static let service = "com.lolekproductions.lotext.ssh"

    /** Made on first use. Kept in the keychain for this device only: not backed up, not synced. */
    static func privateKey() throws -> Curve25519.Signing.PrivateKey {
        if let raw = try read() { return try Curve25519.Signing.PrivateKey(rawRepresentation: raw) }
        let key = Curve25519.Signing.PrivateKey()
        try store(key.rawRepresentation)
        return key
    }

    /** `ssh-ed25519 AAAA… LoText on iPhone` — what goes into `authorized_keys`. */
    static func publicLine(device: String) throws -> String {
        let key = NIOSSHPrivateKey(ed25519Key: try privateKey()).publicKey
        return "\(String(openSSHPublicKey: key)) LoText on \(device)"
    }

    private static func query() -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
    }

    private static func read() throws -> Data? {
        var request = query()
        request[kSecReturnData as String] = true
        request[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        let status = SecItemCopyMatching(request as CFDictionary, &item)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = item as? Data else { throw KeychainError(status) }
        return data
    }

    private static func store(_ data: Data) throws {
        var item = query()
        item[kSecValueData as String] = data
        // Readable once the phone has been unlocked since starting, so a save made as the app
        // goes to the background still gets through; never synchronizable, never migrated.
        item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let status = SecItemAdd(item as CFDictionary, nil)
        guard status == errSecSuccess else { throw KeychainError(status) }
    }
}

struct KeychainError: LocalizedError {
    let status: OSStatus
    init(_ status: OSStatus) { self.status = status }
    var errorDescription: String? {
        let text = SecCopyErrorMessageString(status, nil) as String? ?? "error \(status)"
        return "The key could not be kept in the keychain (\(text))."
    }
}

// MARK: - The servers' keys

/** Trust on first use, kept between launches. */
final class KnownHosts {
    static let shared = KnownHosts()
    private let lock = NSLock()

    private var url: URL? {
        try? FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
            .appendingPathComponent("LoText", isDirectory: true)
            .appendingPathComponent("ssh-known-hosts.json")
    }

    /** True when `key` is the one seen before, or there was none and it is now remembered. */
    func accept(_ key: NIOSSHPublicKey, for server: SSHServer) -> Bool {
        lock.lock(); defer { lock.unlock() }
        let line = String(openSSHPublicKey: key)
        var known = load()
        if let seen = known[server.knownHostsName] { return seen == line }
        known[server.knownHostsName] = line
        save(known)
        return true
    }

    private func load() -> [String: String] {
        guard let url, let data = try? Data(contentsOf: url),
              let known = try? JSONDecoder().decode([String: String].self, from: data) else { return [:] }
        return known
    }

    private func save(_ known: [String: String]) {
        guard let url else { return }
        try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        if let data = try? JSONEncoder().encode(known) { try? data.write(to: url, options: [.atomic]) }
    }
}

// MARK: - Failures

/** The two the store tells apart — "it would not let us in" and "we could not get there". */
enum SSHProblem: Error {
    case refused(String)
    case unreachable(String)
}

struct SSHFailure {
    let code: String
    let message: String

    init(_ error: Error) {
        switch error {
        case SSHProblem.refused(let message):
            (code, self.message) = ("refused", message)
        case SSHProblem.unreachable(let message):
            (code, self.message) = ("unreachable", message)
        default:
            (code, message) = ("unreachable", "The server could not be reached (\(SSHConnections.describe(error))).")
        }
    }
}

// MARK: - Connections

final class SSHConnections {
    static let shared = SSHConnections()

    private let group = MultiThreadedEventLoopGroup(numberOfThreads: 1)
    private var loop: EventLoop { group.next() }
    /** Touched on `loop` only. A connection being made is shared as it is being made. */
    private var open: [SSHServer: Connection] = [:]

    private enum Connection {
        case connecting(EventLoopFuture<Channel>)
        case ready(Channel)
    }

    func run(_ command: String, on server: SSHServer, input: Data?, timeout: TimeAmount) -> EventLoopFuture<SSHAnswer> {
        let loop = self.loop
        return loop.flatSubmit {
            self.connection(to: server).flatMap { parent in
                self.exec(command, on: parent, input: input, timeout: timeout)
            }
        }
    }

    func close(_ server: SSHServer) {
        loop.execute {
            switch self.open.removeValue(forKey: server) {
            case .ready(let channel): channel.close(promise: nil)
            case .connecting(let pending): pending.whenSuccess { $0.close(promise: nil) }
            case nil: break
            }
        }
    }

    /** The open connection to `server`, or a new one when there is none or it has dropped. */
    private func connection(to server: SSHServer) -> EventLoopFuture<Channel> {
        switch open[server] {
        case .ready(let channel) where channel.isActive: return loop.makeSucceededFuture(channel)
        case .connecting(let pending): return pending
        default: break
        }
        let made = connect(to: server)
        open[server] = .connecting(made)
        made.whenComplete { result in
            switch result {
            case .success(let channel):
                self.open[server] = .ready(channel)
                channel.closeFuture.whenComplete { _ in
                    if case .ready(let current) = self.open[server], current === channel { self.open[server] = nil }
                }
            case .failure:
                self.open[server] = nil
            }
        }
        return made
    }

    private func connect(to server: SSHServer) -> EventLoopFuture<Channel> {
        let loop = self.loop
        let key: Curve25519.Signing.PrivateKey
        do {
            key = try SSHKey.privateKey()
        } catch {
            return loop.makeFailedFuture(SSHProblem.refused(error.localizedDescription))
        }
        guard !server.user.isEmpty else {
            return loop.makeFailedFuture(SSHProblem.refused("Name who to log in as: user@host:/path."))
        }

        let ready = loop.makePromise(of: Void.self)
        let bootstrap = ClientBootstrap(group: loop)
            .connectTimeout(.seconds(10))
            .channelOption(ChannelOptions.socket(SocketOptionLevel(IPPROTO_TCP), TCP_NODELAY), value: 1)
            .channelInitializer { channel in
                channel.eventLoop.makeCompletedFuture {
                    let ssh = NIOSSHHandler(
                        role: .client(.init(
                            userAuthDelegate: KeyOffer(user: server.user, key: key),
                            serverAuthDelegate: HostCheck(server: server)
                        )),
                        allocator: channel.allocator,
                        inboundChildChannelInitializer: nil
                    )
                    try channel.pipeline.syncOperations.addHandler(ssh)
                    try channel.pipeline.syncOperations.addHandler(ReadyWatcher(ready: ready))
                }
            }

        return bootstrap.connect(host: server.host, port: server.port)
            .flatMapErrorThrowing { error in
                throw SSHProblem.unreachable("\(server.host) could not be reached (\(Self.describe(error))).")
            }
            .flatMap { channel in
                // Logging in is the server's answer, not the socket's: give it as long as the
                // socket got, then give up on it.
                let limit = loop.scheduleTask(in: .seconds(15)) {
                    ready.fail(SSHProblem.unreachable("The server did not finish logging in."))
                    channel.close(promise: nil)
                }
                return ready.futureResult.map { limit.cancel(); return channel }
                    .flatMapError { error in
                        limit.cancel()
                        channel.close(promise: nil)
                        return loop.makeFailedFuture(error)
                    }
            }
    }

    private func exec(_ command: String, on parent: Channel, input: Data?, timeout: TimeAmount) -> EventLoopFuture<SSHAnswer> {
        let loop = parent.eventLoop
        let answer = loop.makePromise(of: SSHAnswer.self)
        let created = loop.makePromise(of: Channel.self)
        do {
            let ssh = try parent.pipeline.syncOperations.handler(type: NIOSSHHandler.self)
            ssh.createChannel(created, channelType: .session) { child, _ in
                child.eventLoop.makeCompletedFuture {
                    try child.pipeline.syncOperations.addHandler(
                        ExecHandler(command: command, input: input, answer: answer))
                }
            }
        } catch {
            answer.fail(SSHProblem.unreachable("The connection to the server was lost."))
            return answer.futureResult
        }
        created.futureResult.whenFailure { error in
            answer.fail(SSHProblem.unreachable("The server would not run the command (\(Self.describe(error)))."))
        }
        let limit = loop.scheduleTask(in: timeout) {
            answer.fail(SSHProblem.unreachable("The server did not answer in time."))
            created.futureResult.whenSuccess { $0.close(promise: nil) }
        }
        answer.futureResult.whenComplete { _ in limit.cancel() }
        return answer.futureResult
    }

    static func describe(_ error: Error) -> String {
        if let error = error as? NIOConnectionError, let first = error.connectionErrors.first {
            return describe(first.error)
        }
        if let error = error as? IOError { return error.description }
        return String(describing: error)
    }
}

struct SSHAnswer {
    var status: Int
    var output: Data
    var diagnostic: String
}

// MARK: - Handlers

/** Offers the device's key, once. A server that turns it down gets nothing else. */
private final class KeyOffer: NIOSSHClientUserAuthenticationDelegate {
    private let user: String
    private let key: NIOSSHPrivateKey
    private var offered = false

    init(user: String, key: Curve25519.Signing.PrivateKey) {
        self.user = user
        self.key = NIOSSHPrivateKey(ed25519Key: key)
    }

    func nextAuthenticationType(
        availableMethods: NIOSSHAvailableUserAuthenticationMethods,
        nextChallengePromise: EventLoopPromise<NIOSSHUserAuthenticationOffer?>
    ) {
        guard !offered, availableMethods.contains(.publicKey) else {
            nextChallengePromise.fail(SSHProblem.refused(
                "Permission denied: the server did not accept this device’s key. Put its line in \(user)’s ~/.ssh/authorized_keys on the server."))
            return
        }
        offered = true
        nextChallengePromise.succeed(NIOSSHUserAuthenticationOffer(
            username: user, serviceName: "", offer: .privateKey(.init(privateKey: key))))
    }
}

private final class HostCheck: NIOSSHClientServerAuthenticationDelegate {
    private let server: SSHServer
    init(server: SSHServer) { self.server = server }

    func validateHostKey(hostKey: NIOSSHPublicKey, validationCompletePromise: EventLoopPromise<Void>) {
        if KnownHosts.shared.accept(hostKey, for: server) {
            validationCompletePromise.succeed(())
        } else {
            validationCompletePromise.fail(SSHProblem.refused(
                "Host key verification failed: \(server.host) is not presenting the key it did before. If its key was changed on purpose, delete and reinstall LoText to forget the old one."))
        }
    }
}

/** Settles `ready` when the login has gone through, or fails it with why it did not. */
private final class ReadyWatcher: ChannelInboundHandler {
    typealias InboundIn = Any
    private let ready: EventLoopPromise<Void>
    init(ready: EventLoopPromise<Void>) { self.ready = ready }

    func userInboundEventTriggered(context: ChannelHandlerContext, event: Any) {
        if event is UserAuthSuccessEvent { ready.succeed(()) }
        context.fireUserInboundEventTriggered(event)
    }

    func errorCaught(context: ChannelHandlerContext, error: Error) {
        ready.fail(error is SSHProblem ? error : SSHProblem.unreachable("The connection failed (\(SSHConnections.describe(error)))."))
        context.close(promise: nil)
    }

    func channelInactive(context: ChannelHandlerContext) {
        ready.fail(SSHProblem.unreachable("The server closed the connection."))
        context.fireChannelInactive()
    }
}

/**
 * One command on one channel: ask for it, feed it its input and close that side, then gather
 * stdout and stderr until the server closes the channel, carrying the exit status it sent.
 */
private final class ExecHandler: ChannelDuplexHandler {
    typealias InboundIn = SSHChannelData
    typealias OutboundIn = SSHChannelData
    typealias OutboundOut = SSHChannelData

    private let command: String
    private let input: Data?
    private let answer: EventLoopPromise<SSHAnswer>
    private var output = Data()
    private var diagnostic = Data()
    private var status: Int?

    init(command: String, input: Data?, answer: EventLoopPromise<SSHAnswer>) {
        self.command = command
        self.input = input
        self.answer = answer
    }

    func handlerAdded(context: ChannelHandlerContext) {
        context.channel.setOption(ChannelOptions.allowRemoteHalfClosure, value: true).whenFailure { error in
            context.fireErrorCaught(error)
        }
    }

    func channelActive(context: ChannelHandlerContext) {
        let request = SSHChannelRequestEvent.ExecRequest(command: command, wantReply: true)
        context.triggerUserOutboundEvent(request, promise: nil)
        context.fireChannelActive()
    }

    func userInboundEventTriggered(context: ChannelHandlerContext, event: Any) {
        switch event {
        case is ChannelSuccessEvent:
            // The command is running: hand it its input, then end it, so `cat` knows to stop.
            if let input, !input.isEmpty {
                var buffer = context.channel.allocator.buffer(capacity: input.count)
                buffer.writeBytes(input)
                context.writeAndFlush(wrapOutboundOut(SSHChannelData(type: .channel, data: .byteBuffer(buffer))), promise: nil)
            }
            context.close(mode: .output, promise: nil)
        case is ChannelFailureEvent:
            answer.fail(SSHProblem.unreachable("The server would not run the command."))
            context.close(promise: nil)
        case let exit as SSHChannelRequestEvent.ExitStatus:
            status = exit.exitStatus
        case is SSHChannelRequestEvent.ExitSignal:
            status = status ?? 255
        case ChannelEvent.inputClosed:
            // The server has said everything; the channel closes once the exit status is in.
            context.close(promise: nil)
        default:
            context.fireUserInboundEventTriggered(event)
        }
    }

    func channelRead(context: ChannelHandlerContext, data: NIOAny) {
        let message = unwrapInboundIn(data)
        guard case .byteBuffer(let bytes) = message.data else { return }
        switch message.type {
        case .channel: output.append(contentsOf: bytes.readableBytesView)
        case .stdErr: diagnostic.append(contentsOf: bytes.readableBytesView)
        default: break
        }
    }

    func channelInactive(context: ChannelHandlerContext) {
        answer.succeed(SSHAnswer(
            status: status ?? 255,
            output: output,
            diagnostic: String(decoding: diagnostic, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
        ))
        context.fireChannelInactive()
    }

    func errorCaught(context: ChannelHandlerContext, error: Error) {
        answer.fail(SSHProblem.unreachable("The command failed (\(SSHConnections.describe(error)))."))
        context.close(promise: nil)
    }
}
