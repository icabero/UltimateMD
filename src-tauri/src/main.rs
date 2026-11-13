#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod logbook;
mod loose;
mod mcp_check;
mod past;
mod protocol;
mod startup;
mod update;
mod watcher;

use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
use ultimatemd_core::Registry;

const SHOW_FALLBACK: std::time::Duration = std::time::Duration::from_secs(3);

/// Only the app itself and vault files may load in the webview.
fn allowed_navigation(url: &tauri::Url) -> bool {
    let host = url.host_str().unwrap_or("");
    match url.scheme() {
        "tauri" | "umd" | "about" => true,
        "http" => {
            matches!(host, "tauri.localhost" | "umd.localhost") || (cfg!(debug_assertions) && host == "localhost")
        }
        _ => false,
    }
}

/// The installer brings WebView2 along; a portable copy on an old Windows may
/// find it missing, and without it no window can open to say so.
#[cfg(windows)]
fn missing_webview() {
    let text = "UltimateMD necesita Microsoft Edge WebView2, que no está instalado en este equipo. \
Descárgalo gratis desde https://developer.microsoft.com/microsoft-edge/webview2/ o usa el instalador de UltimateMD, que lo instala solo.\n\n\
UltimateMD needs Microsoft Edge WebView2, which is not installed on this computer. \
Get it free from the address above, or use the UltimateMD installer, which installs it for you.";
    rfd::MessageDialog::new()
        .set_level(rfd::MessageLevel::Error)
        .set_title("UltimateMD")
        .set_description(text)
        .set_buttons(rfd::MessageButtons::Ok)
        .show();
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

    #[cfg(windows)]
    if tauri::webview_version().is_err() {
        missing_webview();
        return;
    }

    logbook::start();
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
        .plugin(tauri_plugin_updater::Builder::new().build())
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
                .on_navigation(allowed_navigation);
            // The app draws its own title bar: macOS keeps its buttons over
            // the app, elsewhere the app has its own. Settings can bring the
            // system's back, applied by the frontend before the window shows.
            #[cfg(target_os = "macos")]
            let window = window.title_bar_style(tauri::TitleBarStyle::Overlay).hidden_title(true);
            #[cfg(not(target_os = "macos"))]
            let window = window.decorations(false);
            // The webview keeps the app's own settings; a portable copy keeps
            // them beside it too, not in the user's folder.
            let window = match ultimatemd_core::registry::portable_dir() {
                Some(dir) => window.data_directory(dir.join("webview")),
                None => window,
            };
            let window = window.build()?;
            // A frontend that fails to start must not leave an invisible app.
            std::thread::spawn(move || {
                std::thread::sleep(SHOW_FALLBACK);
                let _ = window.show();
            });
            if let Ok(registry) = Registry::load() {
                for vault in registry.vaults.iter().filter(|v| v.open) {
                    watcher::watch(handle, vault);
                }
                // Deletions the app closed before finishing, such as on a crash.
                let roots: Vec<_> = registry.vaults.iter().map(|v| v.path.clone()).collect();
                std::thread::spawn(move || {
                    for root in roots {
                        let _ = ultimatemd_core::VaultFs::new(root).trash_leftovers();
                    }
                });
            }
            past::tidy();
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
            commands::home_info,
            commands::note_links,
            commands::broken_links,
            commands::repoint_link,
            commands::open_with_system,
            commands::mcp_info,
            commands::export_file,
            commands::undo_trash,
            commands::save_image,
            commands::note_templates,
            commands::note_template,
            commands::save_note_template,
            commands::delete_note_template,
            commands::finish_trash,
            commands::open_exported,
            commands::reveal_exported,
            commands::installer_language,
            commands::set_spellcheck,
            commands::watch_problems,
            commands::check_mcp,
            commands::replace_preview,
            commands::replace_apply,
            commands::vault_tags,
            commands::reveal_path,
            update::update_supported,
            update::portable_data,
            commands::diagram_guide,
            commands::vault_aliases,
            commands::export_site,
            commands::git_status,
            commands::git_committed,
            commands::git_commit,
            commands::save_diagram_guide,
            update::update_install,
            logbook::log_error,
            logbook::read_log,
            logbook::reveal_log,
            past::history_list,
            past::history_read,
            past::history_keep,
            past::ai_log,
            past::ai_undo,
            past::ai_wrote,
            commands::open_path,
            commands::close_loose,
            commands::take_pending_files,
            commands::default_app_info,
            commands::set_default_app,
            commands::vault_themes,
            commands::save_vault_theme,
            commands::delete_vault_theme,
            commands::set_vault_default_theme,
            commands::set_vault_diagram_theme,
            commands::list_templates,
            commands::import_template,
            commands::rename_template,
            commands::delete_template,
            commands::read_image,
            commands::export_docx,
            commands::export_pdf,
            commands::preview_docx,
            commands::preview_pdf,
            commands::template_styles,
            commands::word_config,
            commands::save_word_settings,
            commands::daily_notes,
            commands::save_daily_notes,
            commands::tree_order,
            commands::set_tree_order,
            commands::place_in_tree,
            commands::choose_vault_template,
            commands::remove_vault_template,
            commands::word_sample,
            commands::save_template_copy,
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
