//! Builds a large invented vault and times what the app does with it: open it,
//! list and draw its tree, search, count tags, check links and export.
//!
//!     cargo run --release -p ultimatemd-pdf --example bench_vault -- [notes] [folder]
//!
//! With no folder the vault goes to a temporary one that is removed at the end.
//! The results are a Markdown table, ready for docs/rendimiento.md.

use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};
use ultimatemd_core::docx::{self, Section};
use ultimatemd_core::{VaultFs, links, search, tags};

const PNG: &[u8] = include_bytes!("../../../src-tauri/icons/32x32.png");
const WORDS: &[&str] = &[
    "proyecto",
    "cliente",
    "reunión",
    "entrega",
    "riesgo",
    "plan",
    "equipo",
    "fecha",
    "revisión",
    "diseño",
    "datos",
    "informe",
    "presupuesto",
    "calidad",
    "pruebas",
    "servidor",
    "usuario",
    "acuerdo",
    "objetivo",
    "tarea",
    "versión",
    "documento",
    "análisis",
    "mejora",
    "decisión",
    "contrato",
    "soporte",
    "factura",
    "campaña",
    "lanzamiento",
];

/// A small deterministic generator, so every run builds the same vault.
struct Seq(u64);

impl Seq {
    fn next(&mut self, below: usize) -> usize {
        self.0 = self.0.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        ((self.0 >> 33) % below as u64) as usize
    }

    fn sentence(&mut self, words: usize) -> String {
        let mut s: Vec<&str> = (0..words).map(|_| WORDS[self.next(WORDS.len())]).collect();
        let first = s[0].to_string();
        let mut chars = first.chars();
        let capital: String = chars.next().map(|c| c.to_uppercase().chain(chars).collect()).unwrap_or_default();
        s[0] = &capital;
        format!("{}.", s.join(" "))
    }
}

fn note_path(i: usize) -> String {
    format!("Area {:02}/Proyecto {:02}/Nota {i:05}.md", i / 1000, (i / 100) % 10)
}

fn generate(root: &Path, notes: usize) -> std::io::Result<()> {
    let mut seq = Seq(7);
    for i in 0..notes {
        let path = root.join(note_path(i));
        let dir = path.parent().unwrap();
        if i % 100 == 0 {
            std::fs::create_dir_all(dir)?;
            std::fs::write(dir.join("plano.png"), PNG)?;
        }
        let mut text = format!(
            "---\ntags: [area-{}, {}]\nautor: Ane\n---\n# Nota {i}\n\n{}\n\n",
            i / 1000,
            WORDS[seq.next(WORDS.len())],
            seq.sentence(40)
        );
        for section in 0..3 {
            text.push_str(&format!("## Parte {section}\n\n{}\n\n", seq.sentence(60)));
            let other = seq.next(notes);
            text.push_str(&format!("Relacionada con [[Nota {other:05}]] y #{}.\n\n", WORDS[seq.next(WORDS.len())]));
        }
        if i % 10 == 0 {
            text.push_str("- [ ] Revisar\n- [x] Enviar\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n");
        }
        if i % 25 == 0 {
            text.push_str("![[plano.png]]\n\n```mermaid\nflowchart LR\n  A --> B\n```\n");
        }
        if i % 500 == 0 {
            text.push_str("Un enlace roto: [[No existe]].\n");
        }
        std::fs::write(path, text)?;
    }
    Ok(())
}

/// The median of three runs.
fn time<T>(mut f: impl FnMut() -> T) -> (Duration, T) {
    let mut runs = Vec::new();
    let mut last = None;
    for _ in 0..3 {
        let start = Instant::now();
        last = Some(f());
        runs.push(start.elapsed());
    }
    runs.sort();
    (runs[1], last.unwrap())
}

fn sections(vault: &VaultFs, notes: &[String]) -> Vec<Section> {
    notes
        .iter()
        .map(|p| Section::Note {
            path: p.clone(),
            markdown: vault.read(p).unwrap().content,
            shift: 0,
            page_break: false,
        })
        .collect()
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut args = std::env::args().skip(1);
    let count: usize = args.next().map_or(Ok(10_000), |a| a.parse())?;
    let given = args.next().map(PathBuf::from);
    let temp = tempfile::tempdir()?;
    let root = given.clone().unwrap_or_else(|| temp.path().to_path_buf());

    let mut rows: Vec<(String, Duration, String)> = Vec::new();
    let start = Instant::now();
    generate(&root, count)?;
    rows.push(("Crear el vault".into(), start.elapsed(), format!("{count} notas")));

    let vault = VaultFs::new(&root);
    let (d, notes) = time(|| vault.notes().unwrap());
    rows.push(("Listar las notas".into(), d, format!("{}", notes.len())));
    let (d, tree) = time(|| vault.tree().unwrap());
    rows.push(("Leer el árbol".into(), d, format!("{} carpetas arriba", tree.len())));
    let (d, json) = time(|| serde_json::to_string(&tree).unwrap());
    rows.push(("Pasar el árbol a la interfaz (JSON)".into(), d, format!("{} KB", json.len() / 1024)));
    let (d, bytes) = time(|| notes.iter().map(|p| std::fs::read(root.join(p)).unwrap().len()).sum::<usize>());
    rows.push(("Leer todas las notas del disco".into(), d, format!("{} MB", bytes / 1_000_000)));
    let (d, _) = time(|| notes.iter().map(|p| vault.read(p).unwrap().content.len()).sum::<usize>());
    rows.push(("Leer todas las notas una a una, comprobando cada carpeta".into(), d, String::new()));
    let (d, stamps) = time(|| vault.note_stamps().unwrap());
    rows.push(("Notas recientes".into(), d, format!("{}", stamps.len())));

    for query in ["presupuesto", "\"riesgo plan\"", "tag:area-3 entrega", "/fact.ra/", "palabraquenoesta"] {
        let (d, hits) = time(|| search::search(&vault, query, 50).unwrap());
        rows.push((format!("Buscar `{query}`"), d, format!("{} resultados", hits.len())));
    }
    let (d, counted) = time(|| tags::vault_tags(&vault).unwrap());
    rows.push(("Contar etiquetas".into(), d, format!("{} etiquetas", counted.len())));
    let (d, info) = time(|| links::info(&vault, &note_path(42)).unwrap());
    rows.push(("Enlaces de una nota".into(), d, format!("{} entrantes", info.backlinks.len())));
    let (d, broken) = time(|| links::broken(&vault).unwrap());
    rows.push(("Enlaces rotos del vault".into(), d, format!("{}", broken.len())));

    let image = |note: &str, reference: &str| {
        let dir = note.rsplit_once('/').map_or("", |(d, _)| d);
        std::fs::read(root.join(dir).join(reference.trim_start_matches("./"))).ok()
    };
    let settings = Default::default();
    for size in [100, 1000] {
        let some = &notes[..size.min(notes.len())];
        let parts = sections(&vault, some);
        let (d, bytes) = time(|| {
            docx::render(&docx::Input {
                sections: &parts,
                title: "Banco",
                fixed_title: true,
                date: "",
                contents: "Índice",
                diagrams: &[],
                image: &image,
                template: None,
                settings: &settings,
                inline_numbering: false,
                language: "es",
            })
            .unwrap()
        });
        rows.push((format!("Exportar {} notas a Word", some.len()), d, format!("{} KB", bytes.len() / 1024)));
        let (d, bytes) = time(|| {
            ultimatemd_pdf::render(&ultimatemd_pdf::Input {
                sections: &parts,
                title: "Banco",
                date: "",
                language: "es",
                contents: "Índice",
                cover: false,
                archive: false,
                diagrams: &[],
                image: &image,
            })
            .unwrap()
        });
        rows.push((format!("Exportar {} notas a PDF", some.len()), d, format!("{} KB", bytes.len() / 1024)));
    }

    println!("| Operación | Tiempo | Resultado |\n|---|---:|---|");
    for (what, d, result) in rows {
        println!("| {what} | {:.0} ms | {result} |", d.as_secs_f64() * 1000.0);
    }
    if given.is_some() {
        eprintln!("The vault stays in {}", root.display());
    }
    Ok(())
}
