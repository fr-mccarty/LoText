// LoTextNative on Android — the same plugin as ios/App/App/LoTextNative.swift, answering the same
// methods with the same shapes, so src/mobile/ runs on it unchanged. The JS side is
// src/mobile/native.js.
//
//   the folder     pickFolder  openFolder  forgetFolder  folderAvailable
//   its files      list  read  write  stat  modifiedTimes  exists  createFile  createFolder
//                  move  copy  trash  fileURL                       (FolderStore.java)
//   app data       readData  writeData  removeData      — the app's own storage, never the folder
//   the screen     alert  menu  exportFile  importFile  quickLook  print
//   events         appState { active }   backButton — the system Back, which the page answers
//                  leave                — the page has nothing left to go back to
//
// Not on Android yet, and answered as unavailable so the JS side hides them: Cut and Send to
// DayCap, iCloud sync, and Connect to Server.
//
// A picked folder is a document tree the system lets the app keep: its URI is remembered under an
// id the JS side keeps in its recent list, with the permission taken as persistable, so it reopens
// after a relaunch without being picked again. The id `app` is the app's own folder.

package com.lolekproductions.lotext;

import android.app.Activity;
import androidx.appcompat.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.net.Uri;
import android.print.PrintAttributes;
import android.print.PrintManager;
import android.provider.OpenableColumns;
import android.util.Base64;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.activity.OnBackPressedCallback;
import androidx.activity.result.ActivityResult;
import androidx.core.content.FileProvider;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;

import com.lolekproductions.lotext.FolderStore.Stamp;
import com.lolekproductions.lotext.FolderStore.StoreFailure;

@CapacitorPlugin(name = "LoTextNative")
public class LoTextNativePlugin extends Plugin {

    static final String APP_FOLDER_ID = "app";
    private static final String FOLDERS_KEY = "folderTrees";

    private volatile FolderStore store;
    /** Held while a page is being printed: the print framework keeps no reference to it. */
    private WebView printView;

    // MARK: - Coming and going

    /**
     * Back is the page's to answer — out of a file to the list, or a sheet closed — and only when
     * it has nowhere left to go does it call `leave`, which is what Back would have done.
     */
    @Override
    public void load() {
        getActivity().getOnBackPressedDispatcher().addCallback(getActivity(), new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                notifyListeners("backButton", new JSObject());
            }
        });
    }

    @PluginMethod
    public void leave(PluginCall call) {
        getActivity().runOnUiThread(() -> getActivity().moveTaskToBack(true));
        call.resolve();
    }

    @Override
    protected void handleOnResume() {
        super.handleOnResume();
        JSObject data = new JSObject();
        data.put("active", true);
        notifyListeners("appState", data);
    }

    /** The JS side saves the open file and its preferences on the way out. */
    @Override
    protected void handleOnPause() {
        super.handleOnPause();
        JSObject data = new JSObject();
        data.put("active", false);
        notifyListeners("appState", data);
    }

    // MARK: - The folder

    @PluginMethod
    public void pickFolder(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
            | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION | Intent.FLAG_GRANT_PREFIX_URI_PERMISSION);
        startActivityForResult(call, intent, "folderPicked");
    }

    @ActivityCallback
    private void folderPicked(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Uri tree = result.getResultCode() == Activity.RESULT_OK && result.getData() != null ? result.getData().getData() : null;
        if (tree == null) { call.resolve(new JSObject()); return; }
        try {
            getContext().getContentResolver().takePersistableUriPermission(tree,
                Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            call.resolve(open(remember(tree)));
        } catch (StoreFailure failure) {
            reject(call, failure);
        } catch (SecurityException error) {
            call.reject("LoText was not allowed to keep that folder.", "denied");
        }
    }

    @PluginMethod
    public void openFolder(PluginCall call) {
        String id = call.getString("id");
        if (id == null) { call.reject("No folder was named.", "failed"); return; }
        try {
            call.resolve(open(id));
        } catch (StoreFailure failure) {
            reject(call, failure);
        }
    }

    @PluginMethod
    public void forgetFolder(PluginCall call) {
        String id = call.getString("id");
        JSONObject trees = storedTrees();
        String uri = id == null ? null : trees.optString(id, null);
        if (uri != null) {
            trees.remove(id);
            saveTrees(trees);
            try {
                getContext().getContentResolver().releasePersistableUriPermission(Uri.parse(uri),
                    Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            } catch (SecurityException ignored) {
                // Already gone, which is what was asked for.
            }
        }
        call.resolve();
    }

    @PluginMethod
    public void folderAvailable(PluginCall call) {
        JSObject answer = new JSObject();
        FolderStore current = store;
        answer.put("available", current != null && current.isAvailable());
        call.resolve(answer);
    }

    /** Opens the folder under `id` and makes it the one every file operation resolves against. */
    private JSObject open(String id) throws StoreFailure {
        FolderStore folder;
        String name;
        String detail;
        String path;
        if (APP_FOLDER_ID.equals(id)) {
            File directory = appFolder(getContext());
            folder = FolderStore.ofDirectory(getContext(), directory);
            name = "LoText";
            detail = "";
            path = directory.getAbsolutePath();
        } else {
            String uri = storedTrees().optString(id, null);
            if (uri == null) {
                throw new StoreFailure("notFound", "That folder is no longer known to LoText. Choose it again.");
            }
            Uri tree = Uri.parse(uri);
            folder = FolderStore.ofTree(getContext(), tree);
            name = treeName(tree);
            detail = treeDetail(tree);
            path = uri;
        }
        store = folder;
        JSObject answer = new JSObject();
        answer.put("id", id);
        answer.put("name", name);
        answer.put("detail", detail);
        // Only for filing reading positions, never for reaching a file.
        answer.put("path", path);
        answer.put("available", folder.isAvailable());
        return answer;
    }

    /** A picked folder, remembered — under the id it already had, if it was picked before. */
    private String remember(Uri tree) {
        JSONObject trees = storedTrees();
        for (Iterator<String> ids = trees.keys(); ids.hasNext(); ) {
            String id = ids.next();
            if (tree.toString().equals(trees.optString(id))) return id;
        }
        String id = UUID.randomUUID().toString();
        try {
            trees.put(id, tree.toString());
        } catch (JSONException ignored) {
            // A string under a string key cannot fail.
        }
        saveTrees(trees);
        return id;
    }

    private SharedPreferences preferences() {
        return getContext().getSharedPreferences("LoTextNative", Context.MODE_PRIVATE);
    }

    private JSONObject storedTrees() {
        try {
            return new JSONObject(preferences().getString(FOLDERS_KEY, "{}"));
        } catch (JSONException error) {
            return new JSONObject();
        }
    }

    private void saveTrees(JSONObject trees) {
        preferences().edit().putString(FOLDERS_KEY, trees.toString()).apply();
    }

    /** The app's own folder, made on first use. The first screen is a folder rather than a button. */
    static File appFolder(Context context) {
        File directory = new File(context.getFilesDir(), "Documents");
        //noinspection ResultOfMethodCallIgnored
        directory.mkdirs();
        return directory;
    }

    /** A tree's own name, as the provider gives it: `Notes`, not `primary:Documents/Notes`. */
    private String treeName(Uri tree) {
        String id = android.provider.DocumentsContract.getTreeDocumentId(tree);
        Uri document = android.provider.DocumentsContract.buildDocumentUriUsingTree(tree, id);
        try (Cursor cursor = getContext().getContentResolver().query(document,
                new String[] { OpenableColumns.DISPLAY_NAME }, null, null, null)) {
            if (cursor != null && cursor.moveToFirst() && !cursor.isNull(0)) return cursor.getString(0);
        } catch (RuntimeException ignored) {
            // Named from its id below.
        }
        int cut = Math.max(id.lastIndexOf('/'), id.lastIndexOf(':'));
        return cut >= 0 && cut < id.length() - 1 ? id.substring(cut + 1) : id;
    }

    /** What tells two folders of the same name apart in the recent list: the folder above it. */
    private String treeDetail(Uri tree) {
        String id = android.provider.DocumentsContract.getTreeDocumentId(tree);
        int colon = id.indexOf(':');
        String path = colon >= 0 ? id.substring(colon + 1) : id;
        int slash = path.lastIndexOf('/');
        if (slash > 0) return path.substring(0, slash);
        return "primary".equals(colon >= 0 ? id.substring(0, colon) : "") ? "Internal storage" : "";
    }

    // MARK: - Its files

    private interface StoreWork {
        void run(FolderStore store) throws StoreFailure;
    }

    private void withStore(PluginCall call, StoreWork work) {
        FolderStore current = store;
        if (current == null) { call.reject("No folder is open.", "folderUnavailable"); return; }
        try {
            work.run(current);
        } catch (StoreFailure failure) {
            reject(call, failure);
        } catch (RuntimeException error) {
            call.reject(error.getMessage() == null ? "Something went wrong." : error.getMessage(), "failed");
        }
    }

    @PluginMethod
    public void list(PluginCall call) {
        withStore(call, (store) -> {
            JSObject answer = new JSObject();
            answer.put("entries", store.list(call.getString("path", "")));
            call.resolve(answer);
        });
    }

    @PluginMethod
    public void read(PluginCall call) {
        withStore(call, (store) -> {
            Stamp[] stamp = new Stamp[1];
            byte[] data = store.read(call.getString("path", ""), stamp);
            JSObject answer = stamp[0].json();
            answer.put("data", Base64.encodeToString(data, Base64.NO_WRAP));
            call.resolve(answer);
        });
    }

    @PluginMethod
    public void write(PluginCall call) {
        withStore(call, (store) -> {
            String encoded = call.getString("data");
            if (encoded == null) throw new StoreFailure("failed", "Nothing was sent to write.");
            JSObject expected = call.getObject("expected", null);
            Double modified = null;
            Long size = null;
            if (expected != null && expected.has("modified") && expected.has("size")) {
                modified = expected.optDouble("modified");
                size = expected.optLong("size");
            }
            Stamp stamp = store.write(Base64.decode(encoded, Base64.DEFAULT), call.getString("path", ""), modified, size);
            call.resolve(stamp.json());
        });
    }

    @PluginMethod
    public void stat(PluginCall call) {
        withStore(call, (store) -> {
            boolean[] isFolder = new boolean[1];
            JSObject answer = store.stamp(call.getString("path", ""), isFolder).json();
            answer.put("isFolder", isFolder[0]);
            call.resolve(answer);
        });
    }

    @PluginMethod
    public void modifiedTimes(PluginCall call) {
        withStore(call, (store) -> {
            JSArray paths = call.getArray("paths", new JSArray());
            List<String> list = new ArrayList<>();
            for (int index = 0; index < paths.length(); index += 1) list.add(paths.optString(index, ""));
            JSObject answer = new JSObject();
            answer.put("times", store.modifiedTimes(list));
            call.resolve(answer);
        });
    }

    @PluginMethod
    public void exists(PluginCall call) {
        withStore(call, (store) -> {
            JSObject answer = new JSObject();
            answer.put("exists", store.exists(call.getString("path", "")));
            call.resolve(answer);
        });
    }

    @PluginMethod
    public void createFile(PluginCall call) {
        withStore(call, (store) -> { store.createFile(call.getString("path", "")); call.resolve(); });
    }

    @PluginMethod
    public void createFolder(PluginCall call) {
        withStore(call, (store) -> { store.createFolder(call.getString("path", "")); call.resolve(); });
    }

    @PluginMethod
    public void move(PluginCall call) {
        withStore(call, (store) -> { store.move(call.getString("from", ""), call.getString("to", "")); call.resolve(); });
    }

    @PluginMethod
    public void copy(PluginCall call) {
        withStore(call, (store) -> { store.copy(call.getString("from", ""), call.getString("to", "")); call.resolve(); });
    }

    @PluginMethod
    public void trash(PluginCall call) {
        withStore(call, (store) -> { store.delete(call.getString("path", "")); call.resolve(); });
    }

    /** A file URL for the web view's player, which reads the file itself as it plays. */
    @PluginMethod
    public void fileURL(PluginCall call) {
        withStore(call, (store) -> {
            JSObject answer = new JSObject();
            answer.put("url", Uri.fromFile(store.materialize(call.getString("path", ""))).toString());
            call.resolve(answer);
        });
    }

    // MARK: - App data

    /** The app's own storage, `AppData/<name>`: preferences and the working saves. */
    private File dataFile(PluginCall call) throws StoreFailure {
        String name = call.getString("name");
        if (name == null || name.isEmpty()) throw new StoreFailure("failed", "That is not a name the app keeps data under.");
        for (String part : name.split("/")) {
            if (part.equals("..") || part.equals(".")) throw new StoreFailure("failed", "That is not a name the app keeps data under.");
        }
        return new File(new File(getContext().getFilesDir(), "AppData"), name);
    }

    @PluginMethod
    public void readData(PluginCall call) {
        JSObject answer = new JSObject();
        try (InputStream input = new java.io.FileInputStream(dataFile(call))) {
            answer.put("text", new String(FolderStore.readAll(input), StandardCharsets.UTF_8));
        } catch (Exception error) {
            answer.put("text", JSObject.NULL);
        }
        call.resolve(answer);
    }

    /** Atomic: written beside itself and renamed over, so a half-written file is never read back. */
    @PluginMethod
    public void writeData(PluginCall call) {
        try {
            File file = dataFile(call);
            //noinspection ResultOfMethodCallIgnored
            file.getParentFile().mkdirs();
            File temporary = new File(file.getParentFile(), "." + file.getName() + ".part");
            try (OutputStream output = new FileOutputStream(temporary)) {
                output.write(call.getString("text", "").getBytes(StandardCharsets.UTF_8));
            }
            if (!temporary.renameTo(file)) throw new StoreFailure("failed", "The app's data could not be saved.");
            call.resolve();
        } catch (StoreFailure failure) {
            reject(call, failure);
        } catch (Exception error) {
            call.reject(error.getMessage() == null ? "The app's data could not be saved." : error.getMessage(), "failed");
        }
    }

    @PluginMethod
    public void removeData(PluginCall call) {
        try {
            //noinspection ResultOfMethodCallIgnored
            dataFile(call).delete();
        } catch (StoreFailure ignored) {
            // Nothing by that name, which is what was asked for.
        }
        call.resolve();
    }

    // MARK: - Alerts and menus

    /** The Mac's message box: a title, a sentence, buttons; resolves with the chosen index. */
    @PluginMethod
    public void alert(PluginCall call) {
        JSArray given = call.getArray("buttons", null);
        List<String> buttons = new ArrayList<>();
        if (given != null) for (int index = 0; index < given.length(); index += 1) buttons.add(given.optString(index, ""));
        if (buttons.isEmpty()) buttons.add("OK");
        int cancelIndex = call.getInt("cancelIndex", -1);
        AtomicBoolean answered = new AtomicBoolean(false);
        getActivity().runOnUiThread(() -> {
            AlertDialog.Builder builder = new AlertDialog.Builder(getActivity())
                .setTitle(call.getString("title", ""));
            List<Integer> others = new ArrayList<>();
            for (int index = 0; index < buttons.size(); index += 1) if (index != cancelIndex) others.add(index);
            if (others.size() <= 2) {
                String message = call.getString("message", "");
                if (!message.isEmpty()) builder.setMessage(message);
                // Positive is the right-hand button, where the default answer goes on Android.
                if (others.size() >= 1) builder.setPositiveButton(buttons.get(others.get(0)), (dialog, which) -> answer(call, answered, others.get(0)));
                if (others.size() == 2) builder.setNeutralButton(buttons.get(others.get(1)), (dialog, which) -> answer(call, answered, others.get(1)));
            } else {
                // More answers than a dialog has buttons: a list of them, the sentence as the title's second line.
                String message = call.getString("message", "");
                if (!message.isEmpty()) builder.setTitle(call.getString("title", "") + "\n\n" + message);
                String[] titles = new String[others.size()];
                for (int index = 0; index < others.size(); index += 1) titles[index] = buttons.get(others.get(index));
                builder.setItems(titles, (dialog, which) -> answer(call, answered, others.get(which)));
            }
            if (cancelIndex >= 0 && cancelIndex < buttons.size()) {
                builder.setNegativeButton(buttons.get(cancelIndex), (dialog, which) -> answer(call, answered, cancelIndex));
                builder.setOnCancelListener((dialog) -> answer(call, answered, cancelIndex));
            } else {
                builder.setCancelable(false);
            }
            builder.show();
        });
    }

    /** A list of choices, and Cancel; resolves -1 for Cancel, Back, or a tap outside it. */
    @PluginMethod
    public void menu(PluginCall call) {
        JSArray items = call.getArray("items", new JSArray());
        String[] titles = new String[items.length()];
        for (int index = 0; index < items.length(); index += 1) {
            JSONObject item = items.optJSONObject(index);
            titles[index] = item == null ? "" : item.optString("title", "");
        }
        AtomicBoolean answered = new AtomicBoolean(false);
        getActivity().runOnUiThread(() -> {
            AlertDialog.Builder builder = new AlertDialog.Builder(getActivity());
            String title = call.getString("title");
            if (title != null && !title.isEmpty()) builder.setTitle(title);
            builder.setItems(titles, (dialog, which) -> answer(call, answered, which))
                .setNegativeButton("Cancel", (dialog, which) -> answer(call, answered, -1))
                .setOnCancelListener((dialog) -> answer(call, answered, -1))
                .show();
        });
    }

    /** Each dialog answers its call once, whichever way it is dismissed. */
    private static void answer(PluginCall call, AtomicBoolean answered, int index) {
        if (answered.getAndSet(true)) return;
        JSObject result = new JSObject();
        result.put("index", index);
        call.resolve(result);
    }

    // MARK: - Pickers

    /** Save As… and Export Settings…: the bytes go wherever the user points, as a new document. */
    @PluginMethod
    public void exportFile(PluginCall call) {
        String name = call.getString("name");
        if (name == null || call.getString("data") == null) { call.reject("Nothing was sent to save.", "failed"); return; }
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        // The type a provider reads the name's extension against; a wrong one earns `.txt` on the end.
        intent.setType(FolderStore.viewerMime(name));
        intent.putExtra(Intent.EXTRA_TITLE, name.replace('/', '-'));
        startActivityForResult(call, intent, "fileExported");
    }

    @ActivityCallback
    private void fileExported(PluginCall call, ActivityResult result) {
        if (call == null) return;
        JSObject answer = new JSObject();
        Uri uri = result.getResultCode() == Activity.RESULT_OK && result.getData() != null ? result.getData().getData() : null;
        if (uri == null) { answer.put("name", JSObject.NULL); call.resolve(answer); return; }
        try (OutputStream output = getContext().getContentResolver().openOutputStream(uri, "wt")) {
            if (output == null) throw new java.io.IOException("The file could not be written.");
            output.write(Base64.decode(call.getString("data", ""), Base64.DEFAULT));
            answer.put("name", displayName(uri, call.getString("name")));
            call.resolve(answer);
        } catch (Exception error) {
            call.reject(error.getMessage() == null ? "The file could not be saved." : error.getMessage(), "failed");
        }
    }

    /** Import Settings…: one file's bytes. Any type is offered — a JSON file is often filed as none. */
    @PluginMethod
    public void importFile(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("*/*");
        startActivityForResult(call, intent, "fileImported");
    }

    @ActivityCallback
    private void fileImported(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Uri uri = result.getResultCode() == Activity.RESULT_OK && result.getData() != null ? result.getData().getData() : null;
        if (uri == null) { call.resolve(new JSObject()); return; }
        try (InputStream input = getContext().getContentResolver().openInputStream(uri)) {
            if (input == null) throw new java.io.IOException("The file could not be read.");
            JSObject answer = new JSObject();
            answer.put("name", displayName(uri, "file"));
            answer.put("data", Base64.encodeToString(FolderStore.readAll(input), Base64.NO_WRAP));
            call.resolve(answer);
        } catch (Exception error) {
            call.reject(error.getMessage() == null ? "The file could not be read." : error.getMessage(), "failed");
        }
    }

    private String displayName(Uri uri, String fallback) {
        try (Cursor cursor = getContext().getContentResolver().query(uri, new String[] { OpenableColumns.DISPLAY_NAME }, null, null, null)) {
            if (cursor != null && cursor.moveToFirst() && !cursor.isNull(0)) return cursor.getString(0);
        } catch (RuntimeException ignored) {
            // The name it was asked for will do.
        }
        return fallback;
    }

    // MARK: - Viewing a PDF

    /** iOS's Quick Look: here, whichever app on the device opens PDFs. */
    @PluginMethod
    public void quickLook(PluginCall call) {
        try {
            File file;
            if (call.getString("data") != null) {
                // A server's file, sent as bytes.
                File directory = new File(getContext().getCacheDir(), "viewer");
                //noinspection ResultOfMethodCallIgnored
                directory.mkdirs();
                file = new File(directory, call.getString("name", "document.pdf").replace('/', '-'));
                try (OutputStream output = new FileOutputStream(file)) {
                    output.write(Base64.decode(call.getString("data"), Base64.DEFAULT));
                }
            } else {
                FolderStore current = store;
                if (current == null) { call.reject("No folder is open.", "folderUnavailable"); return; }
                file = current.materialize(call.getString("path", ""));
            }
            Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", file);
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(uri, FolderStore.viewerMime(file.getName()));
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            getActivity().startActivity(intent);
            call.resolve();
        } catch (StoreFailure failure) {
            reject(call, failure);
        } catch (ActivityNotFoundException error) {
            call.reject("No app on this device opens this kind of file.", "failed");
        } catch (Exception error) {
            call.reject(error.getMessage() == null ? "The file could not be shown." : error.getMessage(), "failed");
        }
    }

    // MARK: - Printing

    /**
     * The pages the JS side laid out and drew (src/mobile/printing.js), as one HTML document with
     * the paper's size in its @page rule. A web view nobody sees loads it and hands it to the
     * system's print dialog, which pages it at that size — and which has Save as PDF among its
     * printers, so Share PDF… is the same dialog.
     */
    @PluginMethod
    public void print(PluginCall call) {
        String html = call.getString("html");
        Double width = call.getDouble("pageWidth");
        Double height = call.getDouble("pageHeight");
        if (html == null || width == null || height == null) { call.reject("There was nothing to print.", "failed"); return; }
        String jobName = call.getString("jobName", "LoText");
        getActivity().runOnUiThread(() -> {
            WebView view = new WebView(getActivity());
            printView = view;
            view.setWebViewClient(new WebViewClient() {
                private boolean printed = false;

                @Override
                public void onPageFinished(WebView page, String url) {
                    if (printed) return;
                    printed = true;
                    PrintManager printer = (PrintManager) getActivity().getSystemService(Context.PRINT_SERVICE);
                    PrintAttributes attributes = new PrintAttributes.Builder()
                        .setMediaSize(mediaSize(width, height))
                        .setMinMargins(PrintAttributes.Margins.NO_MARGINS)
                        .build();
                    printer.print(jobName, page.createPrintDocumentAdapter(jobName), attributes);
                    JSObject answer = new JSObject();
                    answer.put("done", true);
                    call.resolve(answer);
                }
            });
            view.loadDataWithBaseURL(null, html, "text/html", "UTF-8", null);
        });
    }

    /** The paper in points, as the print dialog's own size where there is one. */
    private static PrintAttributes.MediaSize mediaSize(double width, double height) {
        int widthMils = (int) Math.round(width * 1000 / 72);
        int heightMils = (int) Math.round(height * 1000 / 72);
        PrintAttributes.MediaSize[] known = {
            PrintAttributes.MediaSize.NA_LETTER, PrintAttributes.MediaSize.NA_LEGAL,
            PrintAttributes.MediaSize.ISO_A4, PrintAttributes.MediaSize.ISO_A5,
        };
        for (PrintAttributes.MediaSize size : known) {
            if (Math.abs(size.getWidthMils() - widthMils) <= 20 && Math.abs(size.getHeightMils() - heightMils) <= 20) return size;
        }
        return new PrintAttributes.MediaSize("lotext", "LoText page", widthMils, heightMils);
    }

    // MARK: - Not on Android yet

    @PluginMethod
    public void dayCapFolder(PluginCall call) {
        JSObject answer = new JSObject();
        answer.put("present", false);
        answer.put("chosen", false);
        call.resolve(answer);
    }

    @PluginMethod
    public void pickDayCapFolder(PluginCall call) { call.resolve(new JSObject()); }

    @PluginMethod
    public void writeToDayCap(PluginCall call) { call.reject("Send to DayCap is not available on Android.", "failed"); }

    @PluginMethod
    public void cloudAvailable(PluginCall call) {
        JSObject answer = new JSObject();
        answer.put("available", false);
        call.resolve(answer);
    }

    @PluginMethod
    public void cloudList(PluginCall call) {
        JSObject answer = new JSObject();
        answer.put("names", new JSONArray());
        call.resolve(answer);
    }

    @PluginMethod
    public void cloudRead(PluginCall call) {
        JSObject answer = new JSObject();
        answer.put("text", JSObject.NULL);
        call.resolve(answer);
    }

    @PluginMethod
    public void cloudWrite(PluginCall call) { call.resolve(); }

    @PluginMethod
    public void sshPublicKey(PluginCall call) {
        JSObject answer = new JSObject();
        answer.put("key", JSObject.NULL);
        call.resolve(answer);
    }

    @PluginMethod
    public void sshRun(PluginCall call) { call.reject("Connect to Server is not available on Android yet.", "unreachable"); }

    @PluginMethod
    public void sshClose(PluginCall call) { call.resolve(); }

    /** The iOS simulator harness's way to tap an alert; nothing answers here. */
    @PluginMethod
    public void answer(PluginCall call) {
        JSObject result = new JSObject();
        result.put("answered", false);
        call.resolve(result);
    }

    // MARK: - Errors

    private static void reject(PluginCall call, StoreFailure failure) {
        call.reject(failure.getMessage(), failure.code, null, failure.data);
    }
}
