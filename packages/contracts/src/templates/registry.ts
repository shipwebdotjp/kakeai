import type { CueLayer } from "../content/layers";
import type { TemplateDisplay, TemplateFieldSpec, VisualTemplateDefinition } from "./shared";
import { setVisualTemplateRegistry, lookupVisualTemplate, templateRegistryKey } from "./lookup";
import { textBlockV1 } from "./text-block";
import { mediaCardV1, mediaFullBleedV1 } from "./media";
import { characterStandingV1 } from "./character-standing";
import { sceneDeviceFrameV1 } from "./device-frame";
import { sceneSiteMockupV1 } from "./site-mockup";
import { compositionFullBleedV1 } from "./composition-full-bleed";
import { tableSimpleV1 } from "./table";
import { chartBarV1 } from "./chart";
import { listCalloutV1 } from "./list-callout";
import { flowDiagramV1 } from "./flow";
import { statV1 } from "./stat";
import { quoteV1 } from "./quote";
import { chatThreadV1 } from "./chat";

export const visualTemplateDefinitions: readonly VisualTemplateDefinition[] = [
  textBlockV1,
  mediaFullBleedV1,
  mediaCardV1,
  characterStandingV1,
  sceneDeviceFrameV1,
  sceneSiteMockupV1,
  compositionFullBleedV1,
  tableSimpleV1,
  chartBarV1,
  listCalloutV1,
  flowDiagramV1,
  statV1,
  quoteV1,
  chatThreadV1,
];

export const visualTemplateRegistry: ReadonlyMap<string, VisualTemplateDefinition> = new Map(
  visualTemplateDefinitions.map((definition) => [
    templateRegistryKey(definition.id, definition.version),
    definition,
  ]),
);
setVisualTemplateRegistry(visualTemplateRegistry);

export function getVisualTemplate(
  id: string,
  version: number,
): VisualTemplateDefinition | undefined {
  return lookupVisualTemplate(id, version);
}

export function getTemplateInputFields(
  id: string,
  version: number,
): readonly TemplateFieldSpec[] | undefined {
  return getVisualTemplate(id, version)?.inputFields;
}

export function isEditableTemplate(id: string, version: number): boolean {
  const fields = getTemplateInputFields(id, version);
  return fields !== undefined && fields.length > 0;
}

export interface VisualTemplateCatalogEntry extends TemplateDisplay {
  id: string;
  version: number;
  layers: readonly CueLayer[];
  editable: boolean;
}

export function listVisualTemplateCatalog(): VisualTemplateCatalogEntry[] {
  return visualTemplateDefinitions.map((definition) => ({
    id: definition.id,
    version: definition.version,
    layers: definition.layers,
    editable: isEditableTemplate(definition.id, definition.version),
    ...definition.display,
  }));
}
