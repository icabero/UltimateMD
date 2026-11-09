use super::*;

const SAMPLE: &str = r#"---
autor: Ane
---
# Informe

Texto con **negrita**, *cursiva*, ~~tachado~~, `código` y un [enlace](https://example.com). Símbolos de Typst: #set $x$ = * _ @ [corchetes] \ "comillas" <tag>.

## Lista

- uno
  - anidado
- dos

3. tres
4. cuatro

- [x] hecha
- [ ] pendiente

| A | B |
|---|---|
| 1 | **2** |

> Una cita.

Nota[^n].

[^n]: Texto de la **nota**.

```rust
fn main() {}
```

```mermaid
flowchart LR
```

![foto](foto.png)

---

Fin.
"#;

const PNG: &[u8] = include_bytes!("../../../src-tauri/icons/32x32.png");

fn note(markdown: &str) -> Vec<Section> {
    vec![Section::Note { path: "n.md".into(), markdown: markdown.into(), shift: 0, page_break: false }]
}

fn input<'a>(
    sections: &'a [Section],
    cover: bool,
    diagrams: &'a [Vec<u8>],
    image: &'a dyn Fn(&str, &str) -> Option<Vec<u8>>,
) -> Input<'a> {
    Input {
        sections,
        title: "Título \"raro\"",
        date: "5/11/2026",
        language: "es",
        contents: "Índice",
        cover,
        archive: false,
        diagrams,
        image,
    }
}

#[test]
fn writes_a_real_pdf_with_every_element() {
    let sections = note(SAMPLE);
    let diagrams = [PNG.to_vec()];
    let image = |_: &str, r: &str| (r == "foto.png").then(|| PNG.to_vec());
    let pdf = render(&input(&sections, true, &diagrams, &image)).unwrap();
    assert!(pdf.starts_with(b"%PDF-"));
}

#[test]
fn the_first_author_goes_to_the_metadata_and_the_cover() {
    let mut sections = note("# Sin autor\n");
    sections.extend(note(SAMPLE));
    sections.extend(note("---\nauthor: Otra\n---\nx\n"));
    let image = |_: &str, _: &str| None;
    let (source, _) = markup::build(&input(&sections, true, &[], &image));
    assert!(source.starts_with("#set document(title: \"Título \\\"raro\\\"\", author: \"Ane\")"), "{source}");
    assert!(source.contains("#text(14pt, \"Ane\")"));
    assert!(!source.contains("Otra\")"));

    let (source, _) = markup::build(&input(&note("x"), true, &[], &image));
    assert!(!source.contains("author:"));
}

#[test]
fn archives_as_pdf_a() {
    let sections = note(SAMPLE);
    let diagrams = [PNG.to_vec()];
    let image = |_: &str, r: &str| (r == "foto.png").then(|| PNG.to_vec());
    let pdf = render(&Input { archive: true, ..input(&sections, true, &diagrams, &image) });
    let pdf = pdf.unwrap_or_else(|e| panic!("{e}"));
    let text = String::from_utf8_lossy(&pdf);
    assert!(text.contains("pdfaid:part") && text.contains("Ane"), "PDF/A metadata with the author");
    assert!(
        !String::from_utf8_lossy(&render(&input(&sections, true, &diagrams, &image)).unwrap()).contains("pdfaid:part")
    );
}

#[test]
fn note_text_cannot_run_as_typst_code() {
    let sections = note(
        "#panic(\"boom\")\n\n[#panic()] `#panic()` $panic$\n\n# #panic()\n\n```\n#panic()\n```\n\n| #panic() |\n|---|\n| x |\n\n[a#panic()](https://e.com/\"#panic())\n",
    );
    let image = |_: &str, _: &str| None;
    let pdf = render(&input(&sections, false, &[], &image));
    assert!(pdf.is_ok(), "{:?}", pdf.err().map(|e| e.to_string()));
}

#[test]
fn missing_assets_do_not_stop_the_export() {
    let sections = note("![x](no.png)\n\n```d2\na\n```\n");
    let image = |_: &str, _: &str| None;
    assert!(render(&input(&sections, false, &[], &image)).is_ok());
}

#[test]
fn a_damaged_image_costs_only_that_image() {
    let sections = note("![x](rota.png)\n");
    let mut damaged = PNG[..40].to_vec();
    damaged.extend_from_slice(&[0; 64]);
    let image = move |_: &str, _: &str| Some(damaged.clone());
    assert!(render(&input(&sections, false, &[], &image)).is_ok());
}

#[test]
fn sections_paginate_and_preview_as_images() {
    let sections = vec![
        Section::Heading { text: "Carpeta".into(), style: None, level: 1, page_break: false },
        Section::Note {
            path: "a.md".into(),
            markdown: "# Una\n\nx[^n]\n\n[^n]: pie\n".into(),
            shift: 1,
            page_break: false,
        },
        Section::Note {
            path: "b.md".into(),
            markdown: "# Dos\n\ny[^n]\n\n[^n]: otro\n".into(),
            shift: 1,
            page_break: true,
        },
    ];
    let image = |_: &str, _: &str| None;
    let pages = preview(&input(&sections, false, &[], &image), 1.0).unwrap();
    assert_eq!(pages.len(), 2);
    assert!(pages[0].starts_with(&[137, 80, 78, 71]));
}

#[test]
fn pages_are_white() {
    let sections = note("# Hola\n");
    let image = |_: &str, _: &str| None;
    let document = compile(&input(&sections, false, &[], &image)).unwrap();
    let pixmap = typst_render::render(&document.pages()[0], &RenderOptions::default());
    assert_eq!(pixmap.pixel(1, 1).map(|p| (p.red(), p.green(), p.blue())), Some((255, 255, 255)));
}

#[test]
fn callouts_are_coloured_boxes_with_a_title() {
    let sections = note("> [!danger] Grietas\n> Ir encordados.\n\n> [!note]\n> Texto.\n\n> Cita.\n");
    let image = |_: &str, _: &str| None;
    let input = input(&sections, false, &[], &image);
    let (source, _) = crate::markup::build(&input);
    assert!(!source.contains("[!"), "{source}");
    assert!(source.contains(r##"fill: rgb("#FEF2F2")"##) && source.contains(r##"fill: rgb("#EFF6FF")"##), "{source}");
    assert!(source.contains("Grietas") && source.contains("Nota"), "{source}");
    assert!(source.contains("#quote(block: true)"), "a plain quote stays a quote");
    assert!(render(&input).unwrap().starts_with(b"%PDF-"));
}
