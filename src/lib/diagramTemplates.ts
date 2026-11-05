// A starting point for every diagram type without a form of its own. Each one is
// edited as code, with the drawing updating alongside it.
import type { Key } from './i18n.svelte';

export interface Template {
  id: string;
  lang: 'mermaid' | 'd2';
  label: Key;
  source: string;
}

export const TEMPLATES: Template[] = [
  {
    id: 'class', lang: 'mermaid', label: 'templates.class',
    source: 'classDiagram\n  class Animal {\n    +String name\n    +eat()\n  }\n  class Dog {\n    +bark()\n  }\n  Animal <|-- Dog',
  },
  {
    id: 'er', lang: 'mermaid', label: 'templates.er',
    source: 'erDiagram\n  CUSTOMER ||--o{ ORDER : places\n  ORDER ||--|{ LINE : contains',
  },
  {
    id: 'timeline', lang: 'mermaid', label: 'templates.timeline',
    source: 'timeline\n  title Project\n  2025 : Idea\n  2026 : Launch',
  },
  {
    id: 'journey', lang: 'mermaid', label: 'templates.journey',
    source: 'journey\n  title My day\n  section Morning\n    Coffee: 5: Me\n    Commute: 2: Me',
  },
  {
    id: 'xychart', lang: 'mermaid', label: 'templates.xychart',
    source: 'xychart-beta\n  title "Sales"\n  x-axis [Jan, Feb, Mar]\n  y-axis "Units" 0 --> 100\n  bar [30, 60, 45]\n  line [30, 60, 45]',
  },
  {
    id: 'quadrant', lang: 'mermaid', label: 'templates.quadrant',
    source: 'quadrantChart\n  title Priorities\n  x-axis Low effort --> High effort\n  y-axis Low value --> High value\n  Task A: [0.3, 0.8]\n  Task B: [0.7, 0.4]',
  },
  {
    id: 'kanban', lang: 'mermaid', label: 'templates.kanban',
    source: 'kanban\n  todo[To do]\n    t1[Task 1]\n  done[Done]\n    t2[Task 2]',
  },
  {
    id: 'git', lang: 'mermaid', label: 'templates.git',
    source: 'gitGraph\n  commit\n  branch develop\n  commit\n  checkout main\n  merge develop',
  },
  {
    id: 'architecture', lang: 'mermaid', label: 'templates.architecture',
    source: 'architecture-beta\n  group api(cloud)[API]\n  service db(database)[Database] in api\n  service server(server)[Server] in api\n  db:L -- R:server',
  },
  {
    id: 'c4', lang: 'mermaid', label: 'templates.c4',
    source: 'C4Context\n  Person(user, "User")\n  System(app, "App")\n  Rel(user, app, "Uses")',
  },
  {
    id: 'sankey', lang: 'mermaid', label: 'templates.sankey',
    source: 'sankey-beta\nA,B,10\nA,C,5\nC,D,5',
  },
  {
    id: 'radar', lang: 'mermaid', label: 'templates.radar',
    source: 'radar-beta\n  title Skills\n  axis a["A"], b["B"], c["C"]\n  curve one["Team"]{4, 3, 5}',
  },
  {
    id: 'treemap', lang: 'mermaid', label: 'templates.treemap',
    source: 'treemap-beta\n"Group"\n    "A": 10\n    "B": 20',
  },
  {
    id: 'block', lang: 'mermaid', label: 'templates.block',
    source: 'block-beta\n  columns 3\n  a["A"] b["B"] c["C"]',
  },
  {
    id: 'packet', lang: 'mermaid', label: 'templates.packet',
    source: 'packet-beta\n  0-15: "Source"\n  16-31: "Target"',
  },
  {
    id: 'requirement', lang: 'mermaid', label: 'templates.requirement',
    source: 'requirementDiagram\n  requirement req1 {\n    id: 1\n    text: The app must start\n    risk: low\n    verifymethod: test\n  }\n  element app {\n    type: software\n  }\n  app - satisfies -> req1',
  },
  {
    id: 'd2-sql', lang: 'd2', label: 'templates.d2Sql',
    source: 'users: {\n  shape: sql_table\n  id: int {constraint: primary_key}\n  name: string\n}\norders: {\n  shape: sql_table\n  id: int {constraint: primary_key}\n  user: int {constraint: foreign_key}\n}\norders.user -> users.id',
  },
  {
    id: 'd2-class', lang: 'd2', label: 'templates.d2Class',
    source: 'Animal: {\n  shape: class\n  name: string\n  +eat(): void\n}\nDog: {\n  shape: class\n  +bark(): void\n}\nDog -> Animal',
  },
  {
    id: 'd2-groups', lang: 'd2', label: 'templates.d2Groups',
    source: 'user\ncloud: {\n  api\n  db: {shape: cylinder}\n  api -> db\n}\nuser -> cloud.api',
  },
  {
    id: 'd2-grid', lang: 'd2', label: 'templates.d2Grid',
    source: 'grid-columns: 2\na\nb\nc\nd',
  },
];
