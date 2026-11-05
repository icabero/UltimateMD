#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod loose;
mod protocol;
mod startup;
mod watcher;

use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
use ultimatemd_core::Registry;

const SHOW_FALLBACK: std::time::Duration = std::time::Duration::from_secs(3);

/// Only the app itself and vault files may load in the webview.
fn allowed_navigation(url: &tauri::Url) -> bool {
    let host = url.host_str().unwrap_or("");
    match url.scheme() {
        "tauri" | "umd" | "about" => true,
        "http" => matches!(host, "tauri.localhost" | "umd.localhost")
            || (cfg!(debug_assertions) && host == "localhost"),
        _ => false,
    }
}

fn main() {
    // WebKitGTK shows a blank window on NVIDIA drivers with its DMA-BUF renderer.
    #[cfg(target_os = "linux")]
    if std::path::Path::new("/proc/driver/nvidia/version").exists()
        && std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none()
    {
        // SAFETY: no other thread exists yet.
        unsafe { std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1") };
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
            startup::deliver(app, startup::files_in_args(args.into_iter().skip(1), cwd.as_ref()));
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(commands::RegistryLock::default())
        .manage(startup::Pending::from_args())
        .manage(watcher::Watchers::default())
        .register_asynchronous_uri_scheme_protocol("umd", |_ctx, request, responder| {
            std::thread::spawn(move || responder.respond(protocol::handle(request)));
        })
        .setup(|app| {
            let handle = app.handle();
            // Drag and drop in the file tree needs the webview's HTML5 events,
            // which the native file-drop handler would otherwise swallow.
            // Hidden until the frontend has applied its theme, so it never flashes.
            let window = WebviewWindowBuilder::new(handle, "main", WebviewUrl::default())
                .title("UltimateMD")
                .visible(false)
                .inner_size(1280.0, 820.0)
                .min_inner_size(720.0, 480.0)
                .disable_drag_drop_handler()
                .on_navigation(allowed_navigation)
                .build()?;
            // A frontend that fails to start must not leave an invisible app.
            std::thread::spawn(move || {
                std::thread::sleep(SHOW_FALLBACK);
                let _ = window.show();
            });
            if let Ok(registry) = Registry::load() {
                for vault in registry.vaults.iter().filter(|v| v.open) {
                    watcher::watch(handle, vault);
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_vaults,
            commands::create_vault,
            commands::open_vault,
            commands::set_vault_open,
            commands::remove_vault,
            commands::rename_vault,
            commands::set_vault_access,
            commands::set_vault_scripts,
            commands::vault_tree,
            commands::read_note,
            commands::write_note,
            commands::create_note,
            commands::create_dir,
            commands::rename_path,
            commands::trash_path,
            commands::search_all,
            commands::note_links,
            commands::open_with_system,
            commands::mcp_info,
            commands::export_file,
            commands::open_path,
            commands::close_loose,
            commands::take_pending_files,
            commands::default_app_info,
            commands::set_default_app,
            commands::list_templates,
            commands::import_template,
            commands::rename_template,
            commands::delete_template,
            commands::read_image,
            commands::export_docx,
        ])
        .build(tauri::generate_context!())
        .expect("error while building UltimateMD")
        .run(|_app, _event| {
            // macOS delivers files as an event rather than as arguments.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = _event {
                let files = urls.into_iter().filter_map(|u| u.to_file_path().ok()).collect();
                startup::deliver(_app, files);
            }
        });
}
