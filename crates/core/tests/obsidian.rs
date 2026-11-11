//! An invented vault written the way Obsidian writes them, to check what
//! UltimateMD understands without changing anything in it. The README's
//! "Vaults de Obsidian" section lists the same things.

use std::path::PathBuf;
use ultimatemd_core::{VaultFs, links, search, tags};

fn vault() -> VaultFs {
    VaultFs::new(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/obsidian"))
}

#[test]
fn obsidian_folders_and_trash_stay_hidden() {
    let notes = vault().notes().unwrap();
    assert_eq!(notes, ["Diario/2026-03-02.md", "Inicio.md", "Proyectos/Web/Lanzamiento.md"]);
    assert!(vault().read(".obsidian/app.json").is_err());
    assert!(vault().read(".trash/Borrada.md").is_err());
}

#[test]
fn wikilinks_resolve_by_name_heading_block_and_folder() {
    let v = vault();
    let notes = v.notes().unwrap();
    for target in ["Lanzamiento", "Proyectos/Web/Lanzamiento", "Inicio"] {
        assert_eq!(
            links::resolve(target, "Inicio.md", &notes).map(String::as_str),
            Some(if target == "Inicio" { "Inicio.md" } else { "Proyectos/Web/Lanzamiento.md" }),
            "{target}"
        );
    }
    let info = links::info(&v, "Proyectos/Web/Lanzamiento.md").unwrap();
    assert_eq!(info.backlinks, ["Diario/2026-03-02.md", "Inicio.md"]);
}

#[test]
fn only_the_missing_note_and_the_alias_are_reported_broken() {
    let broken = links::broken(&vault()).unwrap();
    let mut targets: Vec<&str> = broken.iter().map(|b| b.target.as_str()).collect();
    targets.sort();
    // Aliases from the frontmatter are not followed yet; the README says so.
    assert_eq!(targets, ["Ideas sueltas", "Salida a producción"]);
}

#[test]
fn tags_from_text_and_frontmatter_are_counted() {
    let counted = tags::vault_tags(&vault()).unwrap();
    let names: Vec<&str> = counted.iter().map(|t| t.tag.as_str()).collect();
    for tag in ["diario", "proyecto/web", "cliente", "pendiente"] {
        assert!(names.contains(&tag), "{tag} in {names:?}");
    }
}

#[test]
fn search_finds_words_inside_callouts() {
    let hits = search::search(&vault(), "aviso", 10).unwrap();
    assert_eq!(hits.first().map(|h| h.path.as_str()), Some("Inicio.md"));
}
