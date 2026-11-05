//! PDF export with Typst, a typesetting engine compiled into the app: real
//! pagination on a white page, the same on every platform, with no dialogs.
//!
//! Note text always reaches Typst as escaped strings, so a note can never run
//! as Typst code, however it is written.

mod markup;

use std::collections::HashMap;
use std::sync::LazyLock;
use typst::diag::{FileError, FileResult};
use typst::foundations::{Bytes, Datetime, Duration};
use typst::syntax::{FileId, RootedPath, Source, VirtualPath, VirtualRoot};
use typst::text::{Font, FontBook};
use typst::utils::LazyHash;
use typst::{Library, LibraryExt, World};
use typst_layout::PagedDocument;
use typst_pdf::PdfOptions;
use typst_render::RenderOptions;
use ultimatemd_core::docx::Section;
use ultimatemd_core::{Error, Result};

pub struct Input<'a> {
    pub sections: &'a [Section],
    pub title: &'a str,
    pub date: &'a str,
    /// Adds a cover page and a table of contents.
    pub cover: bool,
    /// Rendered diagrams as PNG, in the order they appear. Empty if rendering failed.
    pub diagrams: &'a [Vec<u8>],
    /// Loads an image: note path, then the reference written in it.
    pub image: &'a dyn Fn(&str, &str) -> Option<Vec<u8>>,
}

struct Fonts {
    book: LazyHash<FontBook>,
    fonts: Vec<Font>,
}

static FONTS: LazyLock<Fonts> = LazyLock::new(|| {
    let fonts: Vec<Font> = typst_assets::fonts().flat_map(|data| Font::iter(Bytes::new(data))).collect();
    Fonts { book: LazyHash::new(FontBook::from_fonts(&fonts)), fonts }
});

static LIBRARY: LazyLock<LazyHash<Library>> = LazyLock::new(|| LazyHash::new(Library::default()));

struct Document {
    main: Source,
    files: HashMap<String, Bytes>,
}

fn file_id(path: &str) -> FileId {
    let path = VirtualPath::new(path).expect("generated paths are valid");
    RootedPath::new(VirtualRoot::Project, path).intern()
}

impl World for Document {
    fn library(&self) -> &LazyHash<Library> {
        &LIBRARY
    }

    fn book(&self) -> &LazyHash<FontBook> {
        &FONTS.book
    }

    fn main(&self) -> FileId {
        self.main.id()
    }

    fn source(&self, id: FileId) -> FileResult<Source> {
        if id == self.main.id() {
            Ok(self.main.clone())
        } else {
            Err(FileError::AccessDenied)
        }
    }

    fn file(&self, id: FileId) -> FileResult<Bytes> {
        let path = id.get().vpath().get_with_slash();
        self.files.get(path).cloned().ok_or(FileError::AccessDenied)
    }

    fn font(&self, index: usize) -> Option<Font> {
        FONTS.fonts.get(index).cloned()
    }

    fn today(&self, _: Option<Duration>) -> Option<Datetime> {
        None
    }
}

fn compile(input: &Input) -> Result<PagedDocument> {
    let (source, images) = markup::build(input);
    let files = images.into_iter().map(|(name, bytes)| (name, Bytes::new(bytes))).collect();
    let world = Document { main: Source::new(file_id("/main.typ"), source), files };
    typst::compile::<PagedDocument>(&world).output.map_err(|errors| {
        let first = errors.first().map_or("unknown error".to_string(), |e| e.message.to_string());
        Error::Vault(format!("could not lay out the PDF: {first}"))
    })
}

/// Generates the PDF.
pub fn render(input: &Input) -> Result<Vec<u8>> {
    let document = compile(input)?;
    typst_pdf::pdf(&document, &PdfOptions::default())
        .map_err(|e| Error::Vault(format!("could not write the PDF: {:?}", e.first().map(|d| d.message.to_string()))))
}

/// Renders the pages as PNG images, exactly as they will print.
pub fn preview(input: &Input, pixels_per_point: f64) -> Result<Vec<Vec<u8>>> {
    let document = compile(input)?;
    let options = RenderOptions { pixel_per_pt: pixels_per_point.into(), ..RenderOptions::default() };
    document
        .pages()
        .iter()
        .map(|page| {
            typst_render::render(page, &options)
                .encode_png()
                .map_err(|e| Error::Vault(e.to_string()))
        })
        .collect()
}

#[cfg(test)]
mod tests;
