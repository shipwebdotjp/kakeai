import { describe, expect, it } from "vitest";
import {
  getTemplateInputFields,
  getVisualTemplate,
  isEditableTemplate,
  listVisualTemplateCatalog,
} from "./index";

describe("visual template metadata", () => {
  it("registers scene.device-frame@2 with an animation field", () => {
    const fields = getTemplateInputFields("scene.device-frame", 2);
    expect(fields?.some((field) => field.kind === "animation")).toBe(true);
    expect(isEditableTemplate("scene.device-frame", 2)).toBe(true);
  });

  it("keeps scene.device-frame@1 free of an animation field", () => {
    const fields = getTemplateInputFields("scene.device-frame", 1);
    expect(fields?.some((field) => field.kind === "animation")).toBe(false);
  });

  it("marks text templates as editable via generic fields", () => {
    expect(isEditableTemplate("text.title", 1)).toBe(true);
    expect(isEditableTemplate("text.body", 1)).toBe(true);
  });

  it("registers scene.site-mockup@1 as an editable card/overlay template", () => {
    const definition = getVisualTemplate("scene.site-mockup", 1);
    expect(definition?.layers).toEqual(["card", "overlay"]);
    expect(isEditableTemplate("scene.site-mockup", 1)).toBe(true);
    const fields = getTemplateInputFields("scene.site-mockup", 1);
    expect(fields?.some((field) => field.kind === "animation")).toBe(true);
    expect(fields?.some((field) => field.key === "logo")).toBe(true);
  });

  it("exposes an editable flag in the catalog", () => {
    const catalog = listVisualTemplateCatalog();
    const standing = catalog.find((entry) => entry.id === "character.standing");
    expect(standing?.editable).toBe(false);
    const deviceFrame = catalog.find(
      (entry) => entry.id === "scene.device-frame" && entry.version === 2,
    );
    expect(deviceFrame?.editable).toBe(true);
  });

  it("returns undefined for unknown template versions", () => {
    expect(getVisualTemplate("scene.device-frame", 99)).toBeUndefined();
    expect(getTemplateInputFields("scene.device-frame", 99)).toBeUndefined();
  });
});
