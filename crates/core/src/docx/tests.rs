use super::*;
use quick_xml::events::Event as Xml;

const PNG: &[u8] = &[
    0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 13, b'I', b'H', b'D', b'R', 0, 0, 0x03, 0xE8, 0, 0, 0x01,
    0xF4, 8, 6, 0, 0, 0, 0, 0, 0, 0,
];

const SAMPLE: &str = "---\nautor: Ane\n---\n# Informe\n\nAntes de la tabla. Texto **fuerte** y *leve* con [web](https://e.com/?a=1&b=2) y [[Otra|alias]].\n\n## Datos & más\n\n- uno\n  - anidado\n- dos\n\n1. primero\n2. segundo\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n> cita\n\nNota[^n].\n\n[^n]: pie.\n\n```mermaid\nflowchart LR\n```\n\n```rust\nfn a() {}\n```\n\n![foto](img.png)\n";

fn note(markdown: &str) -> Vec<Section> {
    vec![Section::Note { path: "n.md".into(), markdown: markdown.into(), shift: 0, page_break: false }]
}

fn render_with(template: Option<&[u8]>) -> Package {
    let diagrams = [PNG.to_vec()];
    let image = |_: &str, path: &str| (path == "img.png").then(|| PNG.to_vec());
    let sections = note(SAMPLE);
    let input = Input {
        sections: &sections,
        title: "archivo",
        fixed_title: false,
        date: "5/11/2026",
        contents: "Índice",
        diagrams: &diagrams,
        image: &image,
        template,
        settings: &Default::default(),
        inline_numbering: false,
    };
    read_package(&render(&input).unwrap()).unwrap()
}

fn assert_well_formed(parts: &Package) {
    for (name, bytes) in parts.iter().filter(|(n, _)| n.ends_with(".xml") || n.ends_with(".rels")) {
        let text = String::from_utf8_lossy(bytes);
        let mut reader = quick_xml::Reader::from_str(&text);
        let mut depth = 0i64;
        loop {
            match reader.read_event() {
                Ok(Xml::Start(_)) => depth += 1,
                Ok(Xml::End(_)) => depth -= 1,
                Ok(Xml::Eof) => break,
                Ok(_) => {}
                Err(e) => panic!("{name} is not well formed: {e}"),
            }
        }
        assert_eq!(depth, 0, "{name}");
    }
}

/// A Spanish-style template: localized ids, a split placeholder, a real
/// contents field and content that must survive.
fn template() -> Vec<u8> {
    let document = format!(
        concat!(
            r#"<?xml version="1.0"?><w:document xmlns:w="{w}" xmlns:r="{r}"><w:body>"#,
            r#"<w:p><w:pPr><w:pStyle w:val="Ttulo"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>{{{{ti</w:t></w:r><w:r><w:t>tulo}}}}</w:t></w:r></w:p>"#,
            r#"<w:p><w:r><w:t>PORTADA de {{{{autor}}}} el {{{{fecha}}}} {{{{desconocido}}}}</w:t></w:r></w:p>"#,
            r#"<w:sdt><w:sdtContent><w:p><w:pPr><w:pStyle w:val="TDC1"/></w:pPr><w:r><w:fldChar w:fldCharType="begin"/></w:r>"#,
            r#"<w:r><w:instrText xml:space="preserve"> TOC \o "1-2" \h \z \u </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>"#,
            r#"<w:r><w:t>Antigua entrada</w:t></w:r><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> PAGEREF a </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>7</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>"#,
            r#"<w:p><w:r><w:t>Otra antigua</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p></w:sdtContent></w:sdt>"#,
            r#"<w:p><w:r><w:t>{{{{</w:t></w:r><w:r><w:t>contenido</w:t></w:r><w:r><w:t>}}}}</w:t></w:r></w:p>"#,
            r#"<w:p><w:r><w:t>ANEXO FINAL</w:t></w:r></w:p>"#,
            r#"<w:sectPr><w:headerReference w:type="default" r:id="rId9"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1" w:right="1000" w:bottom="1" w:left="1000"/></w:sectPr></w:body></w:document>"#
        ),
        w = W_NS,
        r = REL_NS,
    );
    let styles = format!(
        concat!(
            r#"<?xml version="1.0"?><w:styles xmlns:w="{w}"><w:style w:type="paragraph" w:styleId="Ttulo1"><w:name w:val="heading 1"/></w:style>"#,
            r#"<w:style w:type="paragraph" w:styleId="Ttulo2"><w:name w:val="heading 2"/></w:style><w:style w:type="paragraph" w:styleId="TDC2"><w:name w:val="toc 2"/></w:style>"#,
            r#"<w:style w:type="paragraph" w:styleId="Cita"><w:name w:val="Quote"/></w:style><w:style w:type="table" w:styleId="Tablaconcuadrcula"><w:name w:val="Table Grid"/></w:style></w:styles>"#
        ),
        w = W_NS,
    );
    let header = format!(
        r#"<?xml version="1.0"?><w:hdr xmlns:w="{W_NS}"><w:p><w:r><w:t>Cabecera {{{{titulo}}}}</w:t></w:r></w:p></w:hdr>"#
    );
    let settings = format!(
        r#"<?xml version="1.0"?><w:settings xmlns:w="{W_NS}"><w:zoom w:percent="100"/><w:compat/></w:settings>"#
    );
    let numbering = format!(
        r#"<?xml version="1.0"?><w:numbering xmlns:w="{W_NS}"><w:abstractNum w:abstractNumId="3"/><w:num w:numId="4"><w:abstractNumId w:val="3"/></w:num></w:numbering>"#
    );
    let parts: Package = [
        (CONTENT_TYPES, BLANK_TYPES.to_string()),
        (DOCUMENT, document),
        (STYLES, styles),
        ("word/header1.xml", header),
        (SETTINGS, settings),
        (NUMBERING, numbering),
        ("word/theme/theme1.xml", "<a:theme/>".to_string()),
        (DOC_RELS, format!(r#"<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId9" Type="{REL_NS}/header" Target="header1.xml"/></Relationships>"#)),
    ]
    .into_iter()
    .map(|(k, v)| (k.to_string(), v.into_bytes()))
    .collect();
    write_package(&parts).unwrap()
}

fn text(parts: &Package, name: &str) -> String {
    String::from_utf8_lossy(&parts[name]).into_owned()
}

#[test]
fn blank_document_contains_everything() {
    let parts = render_with(None);
    assert_well_formed(&parts);
    let doc = text(&parts, DOCUMENT);
    assert!(doc.contains(r#"<w:pStyle w:val="Heading1"/>"#));
    assert!(doc.contains("<w:b/>"));
    assert!(doc.contains("<w:numPr>"));
    assert!(doc.contains("Datos &amp; más"));
    assert!(doc.contains("alias"), "wikilinks become text");
    assert!(!doc.contains("[["));
    assert_eq!(doc.matches("<w:drawing>").count(), 2, "diagram and image");
    assert!(doc.contains("<w:footnoteReference"));
    assert!(text(&parts, FOOTNOTES).contains("pie."));
    assert!(text(&parts, DOC_RELS).contains("https://e.com/?a=1&amp;b=2"));
    let types = text(&parts, CONTENT_TYPES);
    assert!(types.contains(r#"Extension="png""#) && types.contains("numbering") && types.contains("footnotes"));
}

#[test]
fn tables_keep_their_place_in_the_document() {
    let doc = text(&render_with(None), DOCUMENT);
    let (before, table, after) =
        (doc.find("Antes de la tabla").unwrap(), doc.find("<w:tbl>").unwrap(), doc.find("cita").unwrap());
    assert!(before < table && table < after);
    let inside = &doc[table..doc.find("</w:tbl>").unwrap()];
    assert!(!inside.contains("Antes de la tabla"), "a cell must not swallow earlier text");
    assert_eq!(inside.matches("<w:tc>").count(), 4);
    assert!(inside.contains("<w:tblHeader/>"));
}

#[test]
fn template_content_and_styles_survive() {
    let source = template();
    let parts = render_with(Some(&source));
    assert_well_formed(&parts);
    let doc = text(&parts, DOCUMENT);
    assert!(doc.contains("PORTADA de Ane"));
    assert!(doc.contains("ANEXO FINAL"));
    assert!(doc.contains(r#"<w:pStyle w:val="Ttulo1"/>"#), "styles are found by name, not id");
    assert!(doc.contains(r#"<w:pStyle w:val="Ttulo2"/>"#));
    assert!(doc.contains(r#"<w:pStyle w:val="Cita"/>"#));
    assert!(doc.contains(r#"<w:tblStyle w:val="Tablaconcuadrcula"/>"#));
    assert!(parts.contains_key("word/theme/theme1.xml"));
    assert!(doc.contains("headerReference"), "section settings stay");
    let order = (doc.find("PORTADA").unwrap(), doc.find("Antes de").unwrap(), doc.find("ANEXO").unwrap());
    assert!(order.0 < order.1 && order.1 < order.2, "the body goes at the marker");
    assert!(!doc.contains("contenido"));
}

#[test]
fn placeholders_work_across_runs_and_in_headers() {
    let source = template();
    let parts = render_with(Some(&source));
    let doc = text(&parts, DOCUMENT);
    assert!(doc.contains(">Informe<"), "split placeholder, title from the first heading");
    assert!(doc.contains("<w:rPr><w:b/></w:rPr><w:t xml:space=\"preserve\">Informe"), "keeps the first run's format");
    assert!(doc.contains("el 5/11/2026"));
    assert!(!doc.contains("{{"), "unknown placeholders are removed");
    assert!(text(&parts, "word/header1.xml").contains("Cabecera Informe"));
}

#[test]
fn contents_field_stays_real_and_lists_the_headings() {
    let source = template();
    let parts = render_with(Some(&source));
    let doc = text(&parts, DOCUMENT);
    assert!(doc.contains(r#"TOC \o "1-2""#), "the field is kept");
    assert!(!doc.contains("Antigua entrada") && !doc.contains("Otra antigua"));
    let entry = doc.find("Datos &amp; más").unwrap();
    assert!(entry < doc.find("Antes de").unwrap(), "entries come before the body");
    assert!(doc.contains(r#"<w:pStyle w:val="TDC2"/>"#));
    let (begin, end) = (doc.matches(r#"fldCharType="begin""#).count(), doc.matches(r#"fldCharType="end""#).count());
    assert_eq!((begin, end), (1, 1), "the nested PAGEREF goes with the old entries");
    assert!(!text(&parts, SETTINGS).contains("updateFields"), "Word would warn on opening");
}

#[test]
fn numbering_extends_the_template_in_schema_order() {
    let source = template();
    let xml = text(&render_with(Some(&source)), NUMBERING);
    assert!(xml.contains(r#"w:abstractNumId="3""#), "existing lists stay");
    assert!(xml.rfind("<w:abstractNum ").unwrap() < xml.find("<w:num ").unwrap());
    assert!(xml.contains(r#"<w:num w:numId="5""#), "ids continue after the template's");
}

#[test]
fn images_fit_the_text_width() {
    let source = template();
    let doc = text(&render_with(Some(&source)), DOCUMENT);
    let width = (11906 - 2000) * EMU_PER_TWIP;
    let extents: Vec<u64> =
        Regex::new(r#"<wp:extent cx="(\d+)""#).unwrap().captures_iter(&doc).map(|c| c[1].parse().unwrap()).collect();
    assert_eq!(extents, [500 * EMU_PER_PX, width.min(1000 * EMU_PER_PX)], "diagram at half size, photo capped");
}

#[test]
fn missing_assets_leave_a_note_rather_than_fail() {
    let image = |_: &str, _: &str| None;
    let sections = note("![x](no.png)\n\n```d2\na\n```\n");
    let input = Input {
        sections: &sections,
        title: "t",
        fixed_title: false,
        date: "",
        contents: "Índice",
        diagrams: &[],
        image: &image,
        template: None,
        settings: &Default::default(),
        inline_numbering: false,
    };
    let doc = text(&read_package(&render(&input).unwrap()).unwrap(), DOCUMENT);
    assert!(doc.contains("[Imagen: no.png]") && doc.contains("[Diagrama no disponible]"));
}

#[test]
fn bad_templates_are_rejected() {
    assert!(check_template(b"esto no es un zip").is_err());
    let image = |_: &str, _: &str| None;
    let sections = note("x");
    let input = Input {
        sections: &sections,
        title: "t",
        fixed_title: false,
        date: "",
        contents: "Índice",
        diagrams: &[],
        image: &image,
        template: Some(b"nope"),
        settings: &Default::default(),
        inline_numbering: false,
    };
    assert!(render(&input).is_err());
    assert!(check_template(&template()).is_ok());
}

#[test]
fn title_prefers_frontmatter() {
    let image = |_: &str, _: &str| None;
    let source = template();
    let sections = note("---\ntitulo: Elegido\n---\n# Otro\n");
    let input = Input {
        sections: &sections,
        title: "t",
        fixed_title: false,
        date: "",
        contents: "Índice",
        diagrams: &[],
        image: &image,
        template: Some(&source),
        settings: &Default::default(),
        inline_numbering: false,
    };
    let doc = text(&read_package(&render(&input).unwrap()).unwrap(), DOCUMENT);
    assert!(doc.contains("<w:t xml:space=\"preserve\">Elegido"));
}

#[test]
fn marker_paragraph_keeps_its_breaks() {
    let body = "<w:p>CUERPO</w:p>";
    let marker = |extra: &str| {
        format!("<w:body><w:p>A</w:p><w:p>{extra}<w:r><w:t>{{{{contenido}}}}</w:t></w:r></w:p><w:p>B</w:p></w:body>")
    };

    let plain = insert_body(&marker(""), body, "");
    assert_eq!(plain, "<w:body><w:p>A</w:p><w:p>CUERPO</w:p><w:p>B</w:p></w:body>");

    let direct = insert_body(&marker("<w:pPr><w:pageBreakBefore/></w:pPr>"), body, "");
    assert!(direct.find("pageBreakBefore").unwrap() < direct.find("CUERPO").unwrap(), "the page break comes first");

    let styles = r#"<w:style w:type="paragraph" w:styleId="Salto"><w:name w:val="Salto"/><w:pPr><w:pageBreakBefore/></w:pPr></w:style>"#;
    let styled = insert_body(&marker(r#"<w:pPr><w:pStyle w:val="Salto"/></w:pPr>"#), body, styles);
    assert!(styled.contains("<w:pageBreakBefore/>") && !styled.contains("Salto"), "a style can carry the break");
    assert_eq!(styled.matches("<w:p>").count(), 3, "no empty paragraph is left behind");

    let breaking = r#"<w:p><w:pPr><w:pStyle w:val="H"/><w:pageBreakBefore/></w:pPr>T</w:p>"#;
    let twice = insert_body(&marker("<w:pPr><w:pageBreakBefore/></w:pPr>"), breaking, "");
    assert_eq!(twice.matches("<w:pageBreakBefore/>").count(), 1, "two breaks would leave a blank page");

    let styled_first = r#"<w:p><w:pPr><w:pStyle w:val="H"/></w:pPr>T</w:p>"#;
    let order = insert_body(&marker("<w:pPr><w:pageBreakBefore/></w:pPr>"), styled_first, "");
    assert!(order.contains(r#"<w:pStyle w:val="H"/><w:pageBreakBefore/>"#), "schema order");

    let table = insert_body(&marker("<w:pPr><w:pageBreakBefore/></w:pPr>"), "<w:tbl></w:tbl>", "");
    assert!(table.find("pageBreakBefore").unwrap() < table.find("<w:tbl>").unwrap(), "a table cannot carry it");

    let section = insert_body(&marker("<w:pPr><w:sectPr/></w:pPr>"), body, "");
    assert!(section.find("CUERPO").unwrap() < section.find("<w:sectPr/>").unwrap(), "the body stays in its section");
    assert!(!section.contains("contenido"));
}

fn folder_document() -> Package {
    let sections = vec![
        Section::Heading { text: "Reuniones".into(), style: None, level: 1, page_break: true },
        Section::Note {
            path: "r/a.md".into(),
            markdown: "---\nautor: Ane\n---\n# Lunes\n\nUno[^n].\n\n[^n]: pie uno\n".into(),
            shift: 1,
            page_break: false,
        },
        Section::Heading { text: "Anexo".into(), style: Some("Destacado".into()), level: 2, page_break: false },
        Section::Note {
            path: "r/b.md".into(),
            markdown: "# Martes\n\nDos[^n].\n\n[^n]: pie dos\n".into(),
            shift: 2,
            page_break: true,
        },
    ];
    let image = |_: &str, _: &str| None;
    let source = template();
    let input = Input {
        sections: &sections,
        title: "Vault",
        fixed_title: true,
        date: "",
        contents: "Índice",
        diagrams: &[],
        image: &image,
        template: Some(&source),
        settings: &Default::default(),
        inline_numbering: false,
    };
    read_package(&render(&input).unwrap()).unwrap()
}

#[test]
fn folders_become_titles_and_notes_move_down_a_level() {
    let parts = folder_document();
    assert_well_formed(&parts);
    let doc = text(&parts, DOCUMENT);
    let folder = doc.rfind(">Reuniones<").unwrap();
    assert!(
        doc[..folder].rfind(r#"<w:pPr><w:pStyle w:val="Ttulo1"/><w:pageBreakBefore/></w:pPr>"#).is_some(),
        "style first, then the break"
    );
    let lunes = doc.rfind(">Lunes<").unwrap();
    assert!(doc[..lunes].rfind(r#"w:val="Ttulo2""#).unwrap() > folder, "a note's h1 sits under its folder");
    let martes = doc.rfind(">Martes<").unwrap();
    assert!(
        doc[..martes].rfind(r#"<w:pStyle w:val="Ttulo2"/><w:pageBreakBefore/>"#).is_none_or(|i| i < lunes),
        "shift 2 has no style in this template"
    );
    assert!(doc[..martes].rfind("<w:pageBreakBefore/>").unwrap() > lunes, "a note can start a new page");
}

#[test]
fn custom_styles_stay_in_the_contents() {
    let doc = text(&folder_document(), DOCUMENT);
    assert!(
        doc.contains(r#"<w:pStyle w:val="Destacado"/><w:outlineLvl w:val="1"/>"#),
        "the outline level keeps it listed"
    );
    let toc_end = doc.find(">Reuniones<").unwrap();
    assert!(toc_end < doc.rfind(">Reuniones<").unwrap(), "folder titles appear in the contents");
}

#[test]
fn notes_can_reuse_footnote_labels() {
    let notes = text(&folder_document(), FOOTNOTES);
    assert!(notes.contains("pie uno") && notes.contains("pie dos"));
    assert_eq!(notes.matches("<w:footnote ").count(), 4, "two separators and one note each");
}

#[test]
fn fixed_title_wins_and_the_first_note_gives_the_author() {
    let parts = folder_document();
    assert!(text(&parts, DOCUMENT).contains(">Vault<"));
    assert!(text(&parts, DOCUMENT).contains("PORTADA de Ane"));
}

#[test]
fn example_template_is_complete_and_usable() {
    let source = example_template();
    assert!(check_template(&source).is_ok());
    assert_well_formed(&read_package(&source).unwrap());
    let names: Vec<String> = paragraph_styles(Some(&source)).unwrap().into_iter().map(|s| s.name).collect();
    assert!(names.iter().any(|n| n == "heading 1") && names.iter().any(|n| n == "Quote"));

    let parts = render_with(Some(&source));
    assert_well_formed(&parts);
    let doc = text(&parts, DOCUMENT);
    assert!(doc.contains("TOC \\o") && !doc.contains("{{"));
    assert!(doc.contains(r#"<w:pStyle w:val="TOC2"/>"#));
    assert!(text(&parts, "word/header1.xml").contains("Informe"));
    assert!(!text(&parts, SETTINGS).contains("updateFields"));
}

#[test]
fn a_template_cannot_ask_word_to_update_fields() {
    let settings = r#"<w:settings><w:updateFields w:val="true"/><w:compat/></w:settings>"#;
    assert_eq!(without_field_update(settings), "<w:settings><w:compat/></w:settings>");
}

#[test]
fn tables_fill_the_page_and_fit_their_columns() {
    let parts = render_with(None);
    let doc = text(&parts, DOCUMENT);
    assert!(doc.contains(r#"<w:tblW w:w="5000" w:type="pct"/>"#));
    assert!(doc.contains(r#"<w:tcW w:w="0" w:type="auto"/>"#));
    assert!(doc.contains(r#"w:firstRow="1""#), "a table style can format the first row");
    assert!(!doc.contains(r#"w:type="dxa""#));
}

#[test]
fn the_header_is_bold_only_when_the_table_style_does_not_format_it() {
    let with = r#"<w:style w:type="table" w:styleId="Grid"><w:tblStylePr w:type="firstRow"/></w:style><w:style w:styleId="Otro"/>"#;
    assert!(formats_first_row(with, "Grid"));
    assert!(!formats_first_row(with, "Otro"), "the search stops at the end of the style");
    assert!(!formats_first_row(with, "Falta"));
}

#[test]
fn the_contents_follow_both_switches_of_the_field() {
    assert_eq!(toc_levels(r#" TOC \o "1-2" \h "#), vec![1, 2]);
    assert_eq!(toc_levels(r#" TOC \o "2-3" \t "Título 1;1;Mi-titulo;1" "#), vec![2, 3, 1, 1]);
    assert_eq!(toc_levels(r#" TOC \o &quot;2-3&quot; \t &quot;Título 1;1&quot; "#), vec![2, 3, 1], "escaped quotes");
    assert_eq!(toc_levels(r#" TOC \t "Mi estilo,2" "#), vec![2], "another list separator");
    assert_eq!(toc_levels(" TOC "), vec![1, 2, 3]);
}
