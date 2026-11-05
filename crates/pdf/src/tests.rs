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

fn input<'a>(sections: &'a [Section], cover: bool, diagrams: &'a [Vec<u8>], image: &'a dyn Fn(&str, &str) -> Option<Vec<u8>>) -> Input<'a> {
    Input { sections, title: "Título \"raro\"", date: "5/11/2026", language: "es", contents: "Índice", cover, diagrams, image }
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
fn note_text_cannot_run_as_typst_code() {
    let sections = note("#panic(\"boom\")\n\n[#panic()] `#panic()` $panic$\n\n# #panic()\n\n```\n#panic()\n```\n\n| #panic() |\n|---|\n| x |\n\n[a#panic()](https://e.com/\"#panic())\n");
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
        Section::Note { path: "a.md".into(), markdown: "# Una\n\nx[^n]\n\n[^n]: pie\n".into(), shift: 1, page_break: false },
        Section::Note { path: "b.md".into(), markdown: "# Dos\n\ny[^n]\n\n[^n]: otro\n".into(), shift: 1, page_break: true },
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
