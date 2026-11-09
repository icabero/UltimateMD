// Demo vaults for the screenshots of the website and the README. Runs after
// mock.js and replaces its test files with an invented expedition.
(() => {
  const { files, vaults, vaultThemes } = window.__test;

  const expedition = {
    'Inicio.md': `# Expedición Patagonia 2027

Veintidós días cruzando el **Campo de Hielo Sur**, de El Chaltén a Puerto Natales. Seis personas, dos trineos y ninguna cobertura. Empieza por la [[Ruta]] y el [[Presupuesto]].

## Antes de salir

- [x] Permisos del Parque Nacional
- [x] Seguro de rescate en glaciar
- [ ] Revisar el [[Material]] con el equipo
- [ ] Reservar el vuelo a El Calafate

## Equipo

| Persona | Papel | Experiencia |
| --- | --- | --- |
| Nerea | Jefa de expedición | Ocho travesías polares |
| Tomás | Médico | Rescate en montaña |
| Amaia | Navegación | Guía en Svalbard |
| Julen | Cocina y logística | Campamentos base en Nepal |

## Decidir si cruzamos

\`\`\`mermaid
flowchart LR
  n1("Parte del tiempo")
  n2{"¿Viento menor de 60 km/h?"}
  n3["Cruzar el paso"]
  n4["Esperar en la cueva"]
  n1 --> n2
  n2 -->|Sí| n3
  n2 -->|No| n4
  n4 --> n1
\`\`\`
`,
    'Ruta.md': `# Ruta

Cinco etapas entre el Fitz Roy y el mar. La más delicada es el **Paso del Viento**, donde dependemos de una ventana de buen tiempo.

\`\`\`d2
direction: right
chalten: "El Chaltén" {shape: rectangle; style.border-radius: 12}
paso: "Paso del Viento" {shape: diamond}
circo: "Circo de los Altares" {shape: rectangle}
natales: "Puerto Natales" {shape: rectangle; style.border-radius: 12}
chalten -> paso: "4 días"
paso -> circo: "9 días"
circo -> natales: "9 días"
\`\`\`

## Comunicaciones

\`\`\`mermaid
sequenceDiagram
  participant p1 as Campamento
  participant p2 as Satélite
  participant p3 as Base en Calafate
  p1 ->> p2: Posición diaria
  p2 ->> p3: Mensaje a las 20:00
  p3 -->> p1: Parte meteorológico
\`\`\`

Consulta el [[Calendario]] para ver cuándo llega cada etapa.
`,
    'Logística/Calendario.md': `# Calendario

La expedición sale el 12 de enero. Antes hay que cerrar la preparación física y la logística.

\`\`\`mermaid
gantt
  dateFormat YYYY-MM-DD
  axisFormat %d %b
  Entrenamiento en Pirineos :a1, 2026-11-02, 45d
  Compra de material :a2, 2026-11-16, 30d
  Envío de carga a Calafate :a3, 2026-12-17, 20d
  Travesía :a4, 2027-01-12, 22d
\`\`\`

## Hitos

1. Cierre de presupuesto
2. Prueba de trineos en Baqueira
3. Salida desde Bilbao
`,
    'Logística/Material.md': `# Material

Lo que no vaya en el trineo no existe.

- [x] Tiendas de cuatro estaciones
- [x] Trineos pulka
- [ ] Teléfono satelital y baterías
- [ ] Hornillos de gasolina

\`\`\`mermaid
mindmap
  m0["Equipo"]
    m1["Dormir"]
      m2["Tienda"]
      m3["Saco -30 °C"]
    m4["Moverse"]
      m5["Esquís"]
      m6["Crampones"]
    m7["Sobrevivir"]
      m8["Botiquín"]
      m9["Baliza"]
\`\`\`
`,
    'Logística/Presupuesto.md': `# Presupuesto

Total previsto: **48 500 €**, con un 10 % de margen para imprevistos.

| Partida | Importe | Estado |
| --- | --- | --- |
| Vuelos y traslados | 14 200 € | Pagado |
| Material técnico | 11 800 € | Parcial |
| Permisos y seguros | 9 600 € | Pagado |
| Comida liofilizada | 6 400 € | Pendiente |
| Comunicaciones | 6 500 € | Pendiente |

\`\`\`mermaid
pie title Reparto del gasto
  "Vuelos" : 14200
  "Material" : 11800
  "Permisos" : 9600
  "Comida" : 6400
  "Comunicaciones" : 6500
\`\`\`

El patrocinio de [[Material]] cubre un tercio de la partida técnica.
`,
    'Bitácora/Día 01 - El Chaltén.md': `# Día 01 · El Chaltén

Amanece despejado y el Fitz Roy se deja ver entero. Cargamos los trineos en el refugio y salimos a las nueve.

> El primer día siempre pesa más la mochila que las piernas.

Llegamos al campamento con viento suave. Mañana, la primera subida al glaciar.
`,
    'Bitácora/Día 09 - Paso del Viento.md': `# Día 09 · Paso del Viento

Tres días esperando en la cueva. Hoy el parte da 45 km/h y decidimos cruzar.

- Salida: 05:30
- Llegada al otro lado: 14:10
- Temperatura mínima: -18 °C
`,
  };

  const personal = {
    'Ideas para el libro.md': '# Ideas para el libro\n\n- Empezar por la espera en la cueva, no por la salida.\n- Un capítulo por persona del equipo.\n',
    'Lecturas.md': '# Lecturas\n\n- *Sur*, de Ernest Shackleton\n- *Viaje de una parisiense a Lhasa*, de Alexandra David-Néel\n',
  };

  for (const [id, content] of [['a', expedition], ['b', personal]]) {
    for (const key of Object.keys(files[id])) delete files[id][key];
    Object.assign(files[id], content);
    delete vaultThemes[id];
  }
  vaults[0].name = 'Expedición Patagonia';
  vaults[0].path = '/v/Expedicion';
  vaults[1].name = 'Personal';
})();
