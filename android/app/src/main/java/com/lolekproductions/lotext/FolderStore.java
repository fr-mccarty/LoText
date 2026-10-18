// The folder the app is holding open, and every file operation on it — what FolderStore.swift is
// on iOS, and the native half of src/mobile/mobile-store.js: that file decides *what* to do
// (names, numbering, the rules) and this one does it. Paths arrive store-relative
// (src/shared/file-path.js) and are resolved here against the root, and nowhere else; a path that
// would leave the root is refused.
//
// A folder is one of two things on Android. The app's own folder is a directory in the app's
// storage, reached as plain files. Anything else was picked in the system's folder picker and is
// a *document tree*: no paths at all, only document ids under a provider (the device's storage, an
// SD card, a cloud app), reached through DocumentsContract. Both sit behind `Node`, so everything
// above this file is the same for either.
//
// Errors carry the codes the JS store turns into its own vocabulary: notFound, nameTaken,
// conflict (with the stamp the file has now), denied, folderUnavailable.

package com.lolekproductions.lotext;

import android.content.ContentResolver;
import android.content.Context;
import android.database.Cursor;
import android.net.Uri;
import android.provider.DocumentsContract;
import android.provider.DocumentsContract.Document;
import android.webkit.MimeTypeMap;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

final class FolderStore {

    static final class StoreFailure extends Exception {
        final String code;
        final JSObject data;

        StoreFailure(String code, String message) { this(code, message, null); }

        StoreFailure(String code, String message, JSObject data) {
            super(message);
            this.code = code;
            this.data = data;
        }

        static StoreFailure notFound(String path) {
            return new StoreFailure("notFound", "“" + path + "” is no longer there.");
        }

        static StoreFailure unavailable() {
            return new StoreFailure("folderUnavailable", "The folder is unavailable.");
        }

        static StoreFailure nameTaken(String name) {
            return new StoreFailure("nameTaken", "Something called “" + name + "” is already there.");
        }
    }

    /** Modified time in milliseconds since the epoch, and size in bytes: a file's stamp. */
    static final class Stamp {
        final long modified;
        final long size;

        Stamp(long modified, long size) {
            this.modified = modified;
            this.size = size;
        }

        /** Whole seconds and bytes, exactly as src/shared/file-stamp.js compares them. */
        boolean matches(double otherModified, long otherSize) {
            return Math.floor(modified / 1000.0) == Math.floor(otherModified / 1000.0) && size == otherSize;
        }

        JSObject json() {
            JSObject object = new JSObject();
            object.put("modified", modified);
            object.put("size", size);
            return object;
        }
    }

    /** One entry in the folder: a file or a directory, under either kind of root. */
    private interface Node {
        String name();
        boolean isFolder();
        long modified();
        long size();
        boolean exists();
        List<Node> children() throws StoreFailure;
        Node child(String name) throws StoreFailure;
        Node createFile(String name) throws StoreFailure;
        Node createFolder(String name) throws StoreFailure;
        InputStream open() throws IOException;
        /** In place: truncated and rewritten, never swapped for a new file. */
        OutputStream rewrite() throws IOException;
        void delete() throws StoreFailure;
        /** Same folder, new name. */
        void rename(String name) throws StoreFailure;
        /** Into `folder`, keeping its name; false when the provider cannot, and it must be copied. */
        boolean moveInto(Node folder, Node fromFolder);
    }

    private final Context context;
    private final Node root;
    /** For files the system's viewer opens by URL: plain files already have one. */
    private final File plainRoot;

    private FolderStore(Context context, Node root, File plainRoot) {
        this.context = context;
        this.root = root;
        this.plainRoot = plainRoot;
    }

    static FolderStore ofDirectory(Context context, File directory) {
        return new FolderStore(context, new FileNode(directory), directory);
    }

    static FolderStore ofTree(Context context, Uri tree) {
        String id = DocumentsContract.getTreeDocumentId(tree);
        return new FolderStore(context, new TreeNode(context.getContentResolver(), tree, id, null, true, 0, 0), null);
    }

    boolean isAvailable() {
        try {
            return root.exists() && root.isFolder();
        } catch (RuntimeException error) {
            return false;
        }
    }

    // MARK: - Resolving

    private static List<String> components(String relative) throws StoreFailure {
        List<String> parts = new ArrayList<>();
        for (String part : relative.split("/")) {
            if (part.isEmpty()) continue;
            if (part.equals(".") || part.equals("..")) throw StoreFailure.notFound(relative);
            parts.add(part);
        }
        return parts;
    }

    /** The one place a store-relative path becomes a node. */
    private Node resolve(String relative) throws StoreFailure {
        Node node = root;
        for (String part : components(relative)) {
            node = node.child(part);
            if (node == null) throw StoreFailure.notFound(relative);
        }
        return node;
    }

    /** The folder `relative` would be in, and its last name. */
    private Node parentOf(String relative) throws StoreFailure {
        List<String> parts = components(relative);
        if (parts.isEmpty()) throw StoreFailure.notFound(relative);
        Node node = root;
        for (String part : parts.subList(0, parts.size() - 1)) {
            node = node.child(part);
            if (node == null || !node.isFolder()) throw StoreFailure.notFound(relative);
        }
        return node;
    }

    private static String lastName(String relative) throws StoreFailure {
        List<String> parts = components(relative);
        if (parts.isEmpty()) throw StoreFailure.notFound(relative);
        return parts.get(parts.size() - 1);
    }

    private void requireRoot() throws StoreFailure {
        if (!isAvailable()) throw StoreFailure.unavailable();
    }

    // MARK: - Listing

    /** One level: name, and folder or not. A document tree has no links, so none leaves the folder. */
    JSArray list(String relative) throws StoreFailure {
        requireRoot();
        Node directory = resolve(relative);
        JSArray entries = new JSArray();
        for (Node child : directory.children()) {
            JSObject entry = new JSObject();
            entry.put("name", child.name());
            entry.put("isFolder", child.isFolder());
            entry.put("isLink", false);
            entry.put("leavesTheFolder", false);
            entries.put(entry);
        }
        return entries;
    }

    // MARK: - Reading and writing

    byte[] read(String relative, Stamp[] stampOut) throws StoreFailure {
        requireRoot();
        Node file = resolve(relative);
        if (file.isFolder()) throw new StoreFailure("denied", "That cannot be read here.");
        try (InputStream input = file.open()) {
            byte[] data = readAll(input);
            stampOut[0] = new Stamp(file.modified(), file.size());
            return data;
        } catch (IOException | SecurityException error) {
            throw translate(error, relative);
        }
    }

    /**
     * **The only native function that writes a user's file.** The stamp is checked immediately
     * before the write, and the file is written in place — the same document, truncated and
     * rewritten — because a document swapped for a new one reads to a sync app as a delete and a
     * create.
     */
    Stamp write(byte[] data, String relative, Double expectedModified, Long expectedSize) throws StoreFailure {
        requireRoot();
        Node parent = parentOf(relative);
        String name = lastName(relative);
        Node file = parent.child(name);
        if (expectedModified != null && expectedSize != null) {
            if (file == null) throw StoreFailure.notFound(relative);
            Stamp current = new Stamp(file.modified(), file.size());
            if (!current.matches(expectedModified, expectedSize)) {
                throw new StoreFailure("conflict", "The file changed on disk.", current.json());
            }
        }
        if (file == null) file = parent.createFile(name);
        try (OutputStream output = file.rewrite()) {
            output.write(data);
        } catch (IOException | SecurityException error) {
            throw translate(error, relative);
        }
        Node written = parent.child(name);
        if (written == null) throw StoreFailure.notFound(relative);
        return new Stamp(written.modified(), written.size());
    }

    Stamp stamp(String relative, boolean[] isFolderOut) throws StoreFailure {
        requireRoot();
        Node node = resolve(relative);
        isFolderOut[0] = node.isFolder();
        return new Stamp(node.modified(), node.size());
    }

    /** The modified time of each path in milliseconds, or null for one that cannot be read. */
    JSArray modifiedTimes(List<String> paths) {
        JSArray times = new JSArray();
        for (String relative : paths) {
            try {
                times.put(resolve(relative).modified());
            } catch (StoreFailure | RuntimeException error) {
                times.put(JSObject.NULL);
            }
        }
        return times;
    }

    boolean exists(String relative) {
        try {
            resolve(relative);
            return true;
        } catch (StoreFailure | RuntimeException error) {
            return false;
        }
    }

    // MARK: - Mutations

    /** A new file holding `data`. One already under that name is left alone, and is `nameTaken`. */
    void writeNew(byte[] data, String relative) throws StoreFailure {
        requireRoot();
        Node parent = parentOf(relative);
        String name = lastName(relative);
        if (parent.child(name) != null) throw StoreFailure.nameTaken(name);
        Node file = parent.createFile(name);
        try (OutputStream output = file.rewrite()) {
            output.write(data);
        } catch (IOException | SecurityException error) {
            throw translate(error, relative);
        }
    }

    void createFile(String relative) throws StoreFailure {
        requireRoot();
        Node parent = parentOf(relative);
        String name = lastName(relative);
        if (parent.child(name) != null) throw StoreFailure.nameTaken(name);
        parent.createFile(name);
    }

    void createFolder(String relative) throws StoreFailure {
        requireRoot();
        Node parent = parentOf(relative);
        String name = lastName(relative);
        if (parent.child(name) != null) throw StoreFailure.nameTaken(name);
        parent.createFolder(name);
    }

    /** Renames and moves alike. Never over anything: the JS store picks a free name first. */
    void move(String from, String to) throws StoreFailure {
        requireRoot();
        Node source = resolve(from);
        Node sourceParent = parentOf(from);
        Node targetParent = parentOf(to);
        String sourceName = lastName(from);
        String targetName = lastName(to);
        boolean caseOnly = from.toLowerCase(Locale.ROOT).equals(to.toLowerCase(Locale.ROOT));
        if (!caseOnly && targetParent.child(targetName) != null) throw StoreFailure.nameTaken(targetName);

        if (components(from).subList(0, components(from).size() - 1)
                .equals(components(to).subList(0, components(to).size() - 1))) {
            if (caseOnly && !sourceName.equals(targetName)) {
                // Through a name nothing has, so a volume that ignores case does not see a clash.
                String step = "." + targetName + ".renaming";
                source.rename(step);
                source = sourceParent.child(step);
                if (source == null) throw StoreFailure.notFound(from);
            }
            source.rename(targetName);
            return;
        }
        // Another folder: the provider's own move where it has one, else a copy and a delete.
        if (sourceName.equals(targetName) && source.moveInto(targetParent, sourceParent)) return;
        copyNode(source, targetParent, targetName);
        source.delete();
    }

    void copy(String from, String to) throws StoreFailure {
        requireRoot();
        Node source = resolve(from);
        Node targetParent = parentOf(to);
        String targetName = lastName(to);
        if (targetParent.child(targetName) != null) throw StoreFailure.nameTaken(targetName);
        copyNode(source, targetParent, targetName);
    }

    private void copyNode(Node source, Node intoFolder, String name) throws StoreFailure {
        if (source.isFolder()) {
            Node folder = intoFolder.createFolder(name);
            for (Node child : source.children()) copyNode(child, folder, child.name());
            return;
        }
        Node copy = intoFolder.createFile(name);
        try (InputStream input = source.open(); OutputStream output = copy.rewrite()) {
            byte[] buffer = new byte[64 * 1024];
            for (int count; (count = input.read(buffer)) > 0; ) output.write(buffer, 0, count);
        } catch (IOException | SecurityException error) {
            throw translate(error, name);
        }
    }

    /** Gone for good: a folder on Android keeps no Trash. The JS side has said so first. */
    void delete(String relative) throws StoreFailure {
        requireRoot();
        resolve(relative).delete();
    }

    /**
     * The file as a plain file, for something that opens it by URL — the system's PDF viewer, or
     * the web view's player. A file in a document tree is copied into the cache for it.
     */
    File materialize(String relative) throws StoreFailure {
        requireRoot();
        Node node = resolve(relative);
        if (node.isFolder()) throw StoreFailure.notFound(relative);
        if (plainRoot != null) {
            File file = plainRoot;
            for (String part : components(relative)) file = new File(file, part);
            return file;
        }
        File directory = new File(context.getCacheDir(), "viewer");
        //noinspection ResultOfMethodCallIgnored
        directory.mkdirs();
        File copy = new File(directory, node.name());
        try (InputStream input = node.open(); OutputStream output = new FileOutputStream(copy)) {
            byte[] buffer = new byte[64 * 1024];
            for (int count; (count = input.read(buffer)) > 0; ) output.write(buffer, 0, count);
        } catch (IOException | SecurityException error) {
            throw translate(error, relative);
        }
        return copy;
    }

    // MARK: - Helpers

    static byte[] readAll(InputStream input) throws IOException {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        byte[] buffer = new byte[64 * 1024];
        for (int count; (count = input.read(buffer)) > 0; ) output.write(buffer, 0, count);
        return output.toByteArray();
    }

    private StoreFailure translate(Exception error, String relative) {
        if (error instanceof StoreFailure) return (StoreFailure) error;
        if (!isAvailable()) return StoreFailure.unavailable();
        if (error instanceof SecurityException) return new StoreFailure("denied", "That cannot be read here.");
        if (error instanceof java.io.FileNotFoundException) return StoreFailure.notFound(relative);
        return new StoreFailure("failed", error.getMessage() == null ? "Something went wrong." : error.getMessage());
    }

    /** A new document's type: `application/octet-stream` keeps a provider from adding `.txt`. */
    private static String mimeFor(String name) {
        return "application/octet-stream";
    }

    static String viewerMime(String name) {
        int dot = name.lastIndexOf('.');
        String extension = dot < 0 ? "" : name.substring(dot + 1).toLowerCase(Locale.ROOT);
        String mime = MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension);
        return mime == null ? "application/octet-stream" : mime;
    }

    // MARK: - Plain files: the app's own folder

    private static final class FileNode implements Node {
        private final File file;

        FileNode(File file) { this.file = file; }

        public String name() { return file.getName(); }
        public boolean isFolder() { return file.isDirectory(); }
        public long modified() { return file.lastModified(); }
        public long size() { return file.isDirectory() ? 0 : file.length(); }
        public boolean exists() { return file.exists(); }

        public List<Node> children() throws StoreFailure {
            File[] files = file.listFiles();
            if (files == null) throw new StoreFailure("denied", "That cannot be read here.");
            List<Node> nodes = new ArrayList<>();
            for (File child : files) nodes.add(new FileNode(child));
            return nodes;
        }

        public Node child(String name) {
            File child = new File(file, name);
            return child.exists() ? new FileNode(child) : null;
        }

        public Node createFile(String name) throws StoreFailure {
            File child = new File(file, name);
            try {
                if (!child.createNewFile()) throw StoreFailure.nameTaken(name);
            } catch (IOException error) {
                throw new StoreFailure("failed", error.getMessage());
            }
            return new FileNode(child);
        }

        public Node createFolder(String name) throws StoreFailure {
            File child = new File(file, name);
            if (!child.mkdir()) throw StoreFailure.nameTaken(name);
            return new FileNode(child);
        }

        public InputStream open() throws IOException { return new FileInputStream(file); }
        public OutputStream rewrite() throws IOException { return new FileOutputStream(file, false); }

        public void delete() throws StoreFailure {
            if (!deleteRecursively(file)) throw new StoreFailure("failed", "“" + file.getName() + "” could not be deleted.");
        }

        private static boolean deleteRecursively(File target) {
            File[] children = target.listFiles();
            if (children != null) for (File child : children) if (!deleteRecursively(child)) return false;
            return target.delete();
        }

        public void rename(String name) throws StoreFailure {
            if (!file.renameTo(new File(file.getParentFile(), name))) {
                throw new StoreFailure("failed", "“" + file.getName() + "” could not be renamed.");
            }
        }

        public boolean moveInto(Node folder, Node fromFolder) {
            return folder instanceof FileNode && file.renameTo(new File(((FileNode) folder).file, file.getName()));
        }
    }

    // MARK: - Document trees: a folder picked in the system's picker

    private static final class TreeNode implements Node {
        private static final String[] COLUMNS = {
            Document.COLUMN_DOCUMENT_ID, Document.COLUMN_DISPLAY_NAME, Document.COLUMN_MIME_TYPE,
            Document.COLUMN_LAST_MODIFIED, Document.COLUMN_SIZE,
        };

        private final ContentResolver resolver;
        private final Uri tree;
        private String id;
        private String name;
        private final boolean folder;
        private final long modified;
        private final long size;

        TreeNode(ContentResolver resolver, Uri tree, String id, String name, boolean folder, long modified, long size) {
            this.resolver = resolver;
            this.tree = tree;
            this.id = id;
            this.name = name;
            this.folder = folder;
            this.modified = modified;
            this.size = size;
        }

        private Uri uri() { return DocumentsContract.buildDocumentUriUsingTree(tree, id); }

        public String name() { return name; }
        public boolean isFolder() { return folder; }
        public long modified() { return modified; }
        public long size() { return size; }

        /** The root is the only node made without asking the provider; this asks for it. */
        public boolean exists() {
            try (Cursor cursor = resolver.query(uri(), COLUMNS, null, null, null)) {
                if (cursor == null || !cursor.moveToFirst()) return false;
                return Document.MIME_TYPE_DIR.equals(cursor.getString(2)) || !folder;
            } catch (RuntimeException error) {
                return false;
            }
        }

        public List<Node> children() throws StoreFailure {
            Uri listing = DocumentsContract.buildChildDocumentsUriUsingTree(tree, id);
            List<Node> nodes = new ArrayList<>();
            try (Cursor cursor = resolver.query(listing, COLUMNS, null, null, null)) {
                if (cursor == null) throw StoreFailure.unavailable();
                while (cursor.moveToNext()) {
                    nodes.add(new TreeNode(resolver, tree, cursor.getString(0), cursor.getString(1),
                        Document.MIME_TYPE_DIR.equals(cursor.getString(2)),
                        cursor.isNull(3) ? 0 : cursor.getLong(3), cursor.isNull(4) ? 0 : cursor.getLong(4)));
                }
            } catch (SecurityException error) {
                throw new StoreFailure("denied", "LoText can no longer reach this folder. Choose it again.");
            }
            return nodes;
        }

        public Node child(String childName) throws StoreFailure {
            for (Node node : children()) if (node.name().equals(childName)) return node;
            return null;
        }

        private Node create(String childName, String mime) throws StoreFailure {
            Uri created;
            try {
                created = DocumentsContract.createDocument(resolver, uri(), mime, childName);
            } catch (Exception error) {
                throw new StoreFailure("failed", error.getMessage() == null ? "It could not be made." : error.getMessage());
            }
            if (created == null) throw new StoreFailure("failed", "“" + childName + "” could not be made.");
            Node node = child(childName);
            if (node == null) {
                // The provider renamed it — `notes (1).md` — so it is taken away again.
                try { DocumentsContract.deleteDocument(resolver, created); } catch (Exception ignored) {}
                throw StoreFailure.nameTaken(childName);
            }
            return node;
        }

        public Node createFile(String childName) throws StoreFailure { return create(childName, mimeFor(childName)); }
        public Node createFolder(String childName) throws StoreFailure { return create(childName, Document.MIME_TYPE_DIR); }

        public InputStream open() throws IOException {
            InputStream input = resolver.openInputStream(uri());
            if (input == null) throw new java.io.FileNotFoundException(name);
            return input;
        }

        /** `wt` truncates; a provider that does not know it gets `w`, which most treat the same. */
        public OutputStream rewrite() throws IOException {
            OutputStream output;
            try {
                output = resolver.openOutputStream(uri(), "wt");
            } catch (IllegalArgumentException | UnsupportedOperationException error) {
                output = resolver.openOutputStream(uri(), "w");
            }
            if (output == null) throw new java.io.FileNotFoundException(name);
            return output;
        }

        public void delete() throws StoreFailure {
            try {
                if (!DocumentsContract.deleteDocument(resolver, uri())) {
                    throw new StoreFailure("failed", "“" + name + "” could not be deleted.");
                }
            } catch (StoreFailure failure) {
                throw failure;
            } catch (Exception error) {
                throw new StoreFailure("failed", error.getMessage() == null ? "It could not be deleted." : error.getMessage());
            }
        }

        public void rename(String newName) throws StoreFailure {
            try {
                Uri renamed = DocumentsContract.renameDocument(resolver, uri(), newName);
                if (renamed == null) throw new StoreFailure("failed", "“" + name + "” could not be renamed.");
                id = DocumentsContract.getDocumentId(renamed);
                name = newName;
            } catch (StoreFailure failure) {
                throw failure;
            } catch (Exception error) {
                throw new StoreFailure("failed", error.getMessage() == null ? "It could not be renamed." : error.getMessage());
            }
        }

        public boolean moveInto(Node target, Node fromFolder) {
            if (!(target instanceof TreeNode) || !(fromFolder instanceof TreeNode)) return false;
            try {
                return DocumentsContract.moveDocument(resolver, uri(), ((TreeNode) fromFolder).uri(), ((TreeNode) target).uri()) != null;
            } catch (Exception error) {
                return false;
            }
        }
    }
}
