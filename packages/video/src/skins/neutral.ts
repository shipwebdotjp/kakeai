import {
  NEUTRAL_VISUAL_SKIN_REF,
  chartBarV1,
  chatThreadV1,
  characterStandingV1,
  compositionFullBleedV1,
  deviceFrameInputSchema,
  flowDiagramV1,
  listCalloutV1,
  mediaCardInputSchema,
  mediaCardV1,
  mediaFullBleedInputSchema,
  mediaFullBleedV1,
  quoteV1,
  sceneDeviceFrameV1,
  sceneSiteMockupV1,
  statV1,
  tableSimpleV1,
  textBlockV1,
  type VisualThemeDefinition,
} from "@kakeai/contracts";
import { renderChartBar } from "../templates/chart-bar";
import { renderChatThread } from "../templates/chat-thread";
import { renderCharacterStanding } from "../templates/character-standing";
import { renderCompositionFullBleed } from "../templates/composition-full-bleed";
import { renderDeviceFrame } from "../templates/device-frame";
import { renderFlowDiagram } from "../templates/flow-diagram";
import { renderListCallout } from "../templates/list-callout";
import { renderMediaCard } from "../templates/media-card";
import { renderMediaFullBleed } from "../templates/media-full-bleed";
import { renderQuote } from "../templates/quote";
import { renderSiteMockup } from "../templates/site-mockup";
import { renderStat } from "../templates/stat";
import { renderTableSimple } from "../templates/table-simple";
import { renderTextBlock } from "../templates/text-block";
import { mixHex } from "../theme";
import type { ResolvedVisualSkin, VisualSkinTemplateRenderer } from "./types";

function neutralSceneBackground(accentHex: string, theme: VisualThemeDefinition): string {
  return `linear-gradient(135deg, ${mixHex(accentHex, theme.canvas.base, 0.72)} 0%, ${mixHex(accentHex, theme.canvas.base, 0.88)} 100%)`;
}

const templateRenderers: [string, VisualSkinTemplateRenderer][] = [
  [
    `${textBlockV1.id}@${textBlockV1.version}`,
    (input, context) => ({
      html: renderTextBlock(input, context.path, context.theme, context.document.locale),
      assetIds: [],
      animation: [],
    }),
  ],
  [
    `${mediaFullBleedV1.id}@${mediaFullBleedV1.version}`,
    (input, context) => renderMediaFullBleed(input, context, mediaFullBleedInputSchema),
  ],
  [
    `${mediaCardV1.id}@${mediaCardV1.version}`,
    (input, context) => renderMediaCard(input, context, mediaCardInputSchema),
  ],
  [
    `${characterStandingV1.id}@${characterStandingV1.version}`,
    (input, context) => renderCharacterStanding(input, context),
  ],
  [
    `${sceneDeviceFrameV1.id}@${sceneDeviceFrameV1.version}`,
    (input, context) => renderDeviceFrame(input, context, deviceFrameInputSchema),
  ],
  [
    `${sceneSiteMockupV1.id}@${sceneSiteMockupV1.version}`,
    (input, context) => renderSiteMockup(input, context),
  ],
  [
    `${tableSimpleV1.id}@${tableSimpleV1.version}`,
    (input, context) => renderTableSimple(input, context),
  ],
  [
    `${chartBarV1.id}@${chartBarV1.version}`,
    (input, context) => renderChartBar(input, context),
  ],
  [
    `${listCalloutV1.id}@${listCalloutV1.version}`,
    (input, context) => renderListCallout(input, context),
  ],
  [
    `${flowDiagramV1.id}@${flowDiagramV1.version}`,
    (input, context) => renderFlowDiagram(input, context),
  ],
  [
    `${statV1.id}@${statV1.version}`,
    (input, context) => renderStat(input, context),
  ],
  [
    `${quoteV1.id}@${quoteV1.version}`,
    (input, context) => renderQuote(input, context),
  ],
  [
    `${chatThreadV1.id}@${chatThreadV1.version}`,
    (input, context) => renderChatThread(input, context),
  ],
  [
    `${compositionFullBleedV1.id}@${compositionFullBleedV1.version}`,
    (input, context) => renderCompositionFullBleed(input, context, context.compositionResolver),
  ],
];

export const neutralVisualSkin: ResolvedVisualSkin = {
  ref: NEUTRAL_VISUAL_SKIN_REF,
  templateRenderers: new Map(templateRenderers),
  sceneBackground: neutralSceneBackground,
};
