// A small vault to learn by touching: invented notes that show links,
// diagrams, tables, tasks, tags, a theme and a report ready to export.
import type { Language } from './i18n.svelte';

interface Sample {
  /** The vault's folder name. */
  name: string;
  /** The note opened first. */
  start: string;
  files: Record<string, string>;
}

const FENCE = '```';

const es: Sample = {
  name: 'Ejemplo UltimateMD',
  start: 'Empieza aquí.md',
  files: {
    'Empieza aquí.md': `# Empieza aquí

Este vault es de mentira: tócalo, rómpelo y bórralo cuando quieras. Es una carpeta normal de tu equipo.

## Qué probar

- [ ] Abre [[Enlaces entre notas]] haciendo clic en el enlace.
- [ ] Cambia de vista con los botones de arriba a la derecha, o con Ctrl+\\\\.
- [ ] Mira un [[Diagramas|diagrama]] y edítalo con el botón «Diagrama».
- [ ] Exporta el [[Informe trimestral]] a Word o PDF con Ctrl+E.
- [ ] Busca «presupuesto» con Ctrl+Mayús+F.
- [ ] Pulsa Ctrl+/ para ver todos los atajos.

> [!tip] Consejo
> Todo se guarda solo. Y si te arrepientes de un cambio, la pestaña Historial del panel de la nota guarda versiones anteriores.

#ejemplo
`,
    'Enlaces entre notas.md': `# Enlaces entre notas

Escribe dos corchetes y elige una nota: [[Empieza aquí]]. Puedes apuntar a un título, como [[Informe trimestral#Resultados]], o cambiar el texto: [[Diagramas|así se dibuja]].

Un enlace a una nota que no existe se ve distinto: [[Ideas sueltas]]. Haz clic en él y la app te ofrece crearla.

Si renombras o mueves una nota, los enlaces que apuntan a ella se actualizan solos. El panel de la nota (Ctrl+Mayús+O) enseña quién enlaza a quién.

#ejemplo #enlaces
`,
    'Diagramas.md': `# Diagramas

Un diagrama es texto dentro de un bloque. Este es de Mermaid:

${FENCE}mermaid
flowchart LR
  Idea --> Borrador --> Revisión --> Publicado
  Revisión -->|cambios| Borrador
${FENCE}

Y este de D2, pensado para arquitecturas:

${FENCE}d2
app: Aplicación
datos: Base de datos {shape: cylinder}
app -> datos: consulta
${FENCE}

Pon el cursor dentro de uno y pulsa «Diagrama» en la barra para editarlo con un formulario. En la vista previa, cada diagrama se guarda como SVG o PNG.

#ejemplo
`,
    'Tablas y tareas.md': `---
tema: sepia
---
# Tablas y tareas

Esta nota tiene su propio tema: mira sus propiedades en el panel de la nota.

| Partida | Presupuesto | Gastado |
| --- | ---: | ---: |
| Material | 1 200 | 950 |
| Viajes | 800 | 1 020 |
| Formación | 500 | 120 |

## Pendiente

- [x] Pedir el presupuesto de material
- [ ] Revisar los viajes, que se han pasado
- [ ] Apuntar a dos personas al curso

#ejemplo #presupuesto
`,
    'Informe trimestral.md': `# Informe trimestral

Un documento de ejemplo, listo para exportar con Ctrl+E. Prueba a activar la portada y el índice.

## Resumen

El trimestre cerró con el presupuesto casi cumplido. El detalle está en [[Tablas y tareas]].

## Resultados

1. Se entregaron los tres proyectos previstos.
2. Los viajes superaron lo presupuestado.
3. La formación se queda para el trimestre siguiente.

${FENCE}mermaid
pie title Reparto del gasto
  "Material" : 950
  "Viajes" : 1020
  "Formación" : 120
${FENCE}

## Próximos pasos

> [!important] Decisión pendiente
> Hay que decidir si se amplía la partida de viajes.

#ejemplo #presupuesto
`,
  },
};

const en: Sample = {
  name: 'UltimateMD example',
  start: 'Start here.md',
  files: {
    'Start here.md': `# Start here

This vault is made up: touch it, break it and delete it whenever you like. It is a plain folder on your computer.

## Things to try

- [ ] Open [[Links between notes]] by clicking the link.
- [ ] Switch views with the buttons at the top right, or with Ctrl+\\\\.
- [ ] Look at a [[Diagrams|diagram]] and edit it with the Diagram button.
- [ ] Export the [[Quarterly report]] to Word or PDF with Ctrl+E.
- [ ] Search for "budget" with Ctrl+Shift+F.
- [ ] Press Ctrl+/ to see every shortcut.

> [!tip] Tip
> Everything saves by itself. And if you regret a change, the History tab of the note panel keeps earlier versions.

#example
`,
    'Links between notes.md': `# Links between notes

Type two square brackets and choose a note: [[Start here]]. You can point at a heading, like [[Quarterly report#Results]], or change the text: [[Diagrams|this is how to draw]].

A link to a note that does not exist looks different: [[Loose ideas]]. Click it and the app offers to create it.

When you rename or move a note, the links that point to it update by themselves. The note panel (Ctrl+Shift+O) shows what links to what.

#example #links
`,
    'Diagrams.md': `# Diagrams

A diagram is text inside a block. This one is Mermaid:

${FENCE}mermaid
flowchart LR
  Idea --> Draft --> Review --> Published
  Review -->|changes| Draft
${FENCE}

And this one is D2, made for architectures:

${FENCE}d2
app: Application
data: Database {shape: cylinder}
app -> data: query
${FENCE}

Put the cursor inside one and press Diagram in the toolbar to edit it with a form. In the preview, each diagram saves as SVG or PNG.

#example
`,
    'Tables and tasks.md': `---
tema: sepia
---
# Tables and tasks

This note has a theme of its own: see its properties in the note panel.

| Item | Budget | Spent |
| --- | ---: | ---: |
| Supplies | 1,200 | 950 |
| Travel | 800 | 1,020 |
| Training | 500 | 120 |

## To do

- [x] Ask for the supplies quote
- [ ] Review travel, which went over
- [ ] Sign two people up for the course

#example #budget
`,
    'Quarterly report.md': `# Quarterly report

A sample document, ready to export with Ctrl+E. Try turning on the cover and the contents.

## Summary

The quarter closed with the budget almost met. The detail is in [[Tables and tasks]].

## Results

1. The three planned projects were delivered.
2. Travel went over budget.
3. Training moves to the next quarter.

${FENCE}mermaid
pie title Where the money went
  "Supplies" : 950
  "Travel" : 1020
  "Training" : 120
${FENCE}

## Next steps

> [!important] Decision pending
> Whether to raise the travel budget has to be decided.

#example #budget
`,
  },
};

const eu: Sample = {
  name: 'UltimateMD adibidea',
  start: 'Hasi hemen.md',
  files: {
    'Hasi hemen.md': `# Hasi hemen

Vault hau asmatua da: ukitu, hautsi eta ezabatu nahi duzunean. Zure ordenagailuko karpeta arrunt bat da.

## Zer probatu

- [ ] Ireki [[Oharren arteko estekak]] estekan klik eginda.
- [ ] Aldatu ikuspegia goian eskuinean dauden botoiekin, edo Ctrl+\\\\ sakatuta.
- [ ] Begiratu [[Diagramak|diagrama]] bat eta editatu «Diagrama» botoiarekin.
- [ ] Esportatu [[Hiruhileko txostena]] Word edo PDFra Ctrl+E sakatuta.
- [ ] Bilatu «aurrekontua» Ctrl+Maius+F sakatuta.
- [ ] Sakatu Ctrl+/ lasterbide guztiak ikusteko.

> [!tip] Aholkua
> Dena bere kabuz gordetzen da. Eta aldaketa batez damutzen bazara, oharraren paneleko Historia fitxak aurreko bertsioak gordetzen ditu.

#adibidea
`,
    'Oharren arteko estekak.md': `# Oharren arteko estekak

Idatzi bi kortxete eta aukeratu ohar bat: [[Hasi hemen]]. Izenburu batera jo dezakezu, hala nola [[Hiruhileko txostena#Emaitzak]], edo testua aldatu: [[Diagramak|horrela marrazten da]].

Existitzen ez den ohar baterako esteka desberdin ikusten da: [[Ideia solteak]]. Egin klik eta aplikazioak sortzea eskainiko dizu.

Ohar bat berrizendatzen edo mugitzen baduzu, hara doazen estekak berez eguneratzen dira. Oharraren panelak (Ctrl+Maius+O) nork nori estekatzen dion erakusten du.

#adibidea #estekak
`,
    'Diagramak.md': `# Diagramak

Diagrama bat bloke baten barruko testua da. Hau Mermaid da:

${FENCE}mermaid
flowchart LR
  Ideia --> Zirriborroa --> Berrikuspena --> Argitaratua
  Berrikuspena -->|aldaketak| Zirriborroa
${FENCE}

Eta hau D2, arkitekturetarako pentsatua:

${FENCE}d2
app: Aplikazioa
datuak: Datu-basea {shape: cylinder}
app -> datuak: kontsulta
${FENCE}

Jarri kurtsorea baten barruan eta sakatu «Diagrama» tresna-barran, formulario batekin editatzeko. Aurrebistan, diagrama bakoitza SVG edo PNG gisa gordetzen da.

#adibidea
`,
    'Taulak eta zereginak.md': `---
tema: sepia
---
# Taulak eta zereginak

Ohar honek bere gaia du: ikusi bere propietateak oharraren panelean.

| Partida | Aurrekontua | Gastatua |
| --- | ---: | ---: |
| Materiala | 1.200 | 950 |
| Bidaiak | 800 | 1.020 |
| Prestakuntza | 500 | 120 |

## Egitekoak

- [x] Materialaren aurrekontua eskatu
- [ ] Bidaiak berrikusi, gainditu baitira
- [ ] Bi pertsona ikastaroan izena eman

#adibidea #aurrekontua
`,
    'Hiruhileko txostena.md': `# Hiruhileko txostena

Adibidezko dokumentu bat, Ctrl+E sakatuta esportatzeko prest. Probatu azala eta aurkibidea aktibatzen.

## Laburpena

Hiruhilekoa aurrekontua ia beteta itxi zen. Xehetasuna [[Taulak eta zereginak]] oharrean dago.

## Emaitzak

1. Aurreikusitako hiru proiektuak entregatu ziren.
2. Bidaiek aurrekontua gainditu zuten.
3. Prestakuntza hurrengo hiruhilekorako geratzen da.

${FENCE}mermaid
pie title Gastuaren banaketa
  "Materiala" : 950
  "Bidaiak" : 1020
  "Prestakuntza" : 120
${FENCE}

## Hurrengo urratsak

> [!important] Erabakia egiteke
> Bidaien partida handitu behar den erabaki behar da.

#adibidea #aurrekontua
`,
  },
};

const SAMPLES: Record<Language, Sample> = { es, en, eu };

/** The sample vault in a language. */
export const sampleVault = (language: Language) => SAMPLES[language];
