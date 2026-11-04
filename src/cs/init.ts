import { init as csInit, RenderingEngine, cache, eventTarget } from '@cornerstonejs/core';
import dicomImageLoader from '@cornerstonejs/dicom-image-loader';
import {
  init as toolsInit,
  addTool,
  ToolGroupManager,
  StackScrollTool,
  WindowLevelTool,
  ZoomTool,
  PanTool,
  LengthTool,
  AngleTool,
  CobbAngleTool,
  CircleROITool,
  CrosshairsTool,
  Enums as ToolEnums,
  annotation,
} from '@cornerstonejs/tools';
import { registerLocalImageLoader } from './localImageLoader';
import { angleText, circleText, cobbText, lengthText } from './measure';

export const RENDERING_ENGINE_ID = 'bv-engine';
export const MAIN_TOOLGROUP = 'bv-main';
export const MPR_TOOLGROUP = 'bv-mpr';
export const EXPORT_TOOLGROUP = 'bv-export';

export type ToolId = 'scroll' | 'window' | 'zoom' | 'pan' | 'length' | 'angle' | 'cobb' | 'circle' | 'mask' | 'crop';

export const TOOL_NAMES: Partial<Record<ToolId, string>> = {
  scroll: StackScrollTool.toolName,
  window: WindowLevelTool.toolName,
  zoom: ZoomTool.toolName,
  pan: PanTool.toolName,
  length: LengthTool.toolName,
  angle: AngleTool.toolName,
  cobb: CobbAngleTool.toolName,
  circle: CircleROITool.toolName,
};

export const MEASUREMENT_TOOLS = [LengthTool.toolName, AngleTool.toolName, CobbAngleTool.toolName, CircleROITool.toolName];

let engine: RenderingEngine | null = null;

export function getEngine() {
  if (!engine) engine = new RenderingEngine(RENDERING_ENGINE_ID);
  return engine;
}

export async function initCornerstone() {
  csInit();
  dicomImageLoader.init({ maxWebWorkers: Math.max(1, Math.min(4, Math.floor((navigator.hardwareConcurrency || 2) / 2))) });
  registerLocalImageLoader();
  toolsInit();
  // bounded cache for decoded images (memory control)
  cache.setMaxCacheSize(768 * 1024 * 1024);

  [StackScrollTool, WindowLevelTool, ZoomTool, PanTool, LengthTool, AngleTool, CobbAngleTool, CircleROITool, CrosshairsTool].forEach((T) => addTool(T));

  const defaults: any = annotation.config.style.getDefaultToolStyles();
  annotation.config.style.setDefaultToolStyles({
    ...defaults,
    global: {
      ...(defaults.global ?? {}),
      textBoxVisibility: true,
      color: '#57C8CE',
      colorHighlighted: '#ffffff',
      colorSelected: '#ffffff',
      lineWidth: '2',
      textBoxFontFamily: 'Geist Variable, DM Sans, Helvetica, Arial, sans-serif',
      textBoxFontSize: '15px',
      textBoxColor: '#ffffff',
      textBoxColorHighlighted: '#ffffff',
      textBoxColorSelected: '#ffffff',
      textBoxBackground: 'rgba(8,43,67,0.72)',
      textBoxShadow: false,
      shadow: true,
    },
  } as any);

  const main = ToolGroupManager.createToolGroup(MAIN_TOOLGROUP)!;
  addMeasurementTools(main);
  main.addTool(StackScrollTool.toolName);
  main.addTool(WindowLevelTool.toolName);
  main.addTool(ZoomTool.toolName);
  main.addTool(PanTool.toolName);

  // Export group: renders annotations only (no interaction)
  const exp = ToolGroupManager.createToolGroup(EXPORT_TOOLGROUP)!;
  addMeasurementTools(exp);

  const mpr = ToolGroupManager.createToolGroup(MPR_TOOLGROUP)!;
  mpr.addTool(StackScrollTool.toolName);
  mpr.addTool(WindowLevelTool.toolName);
  mpr.addTool(ZoomTool.toolName);
  mpr.addTool(PanTool.toolName);
  mpr.addTool(CrosshairsTool.toolName, {
    getReferenceLineColor: (id: string) => ({ 'mpr-axial': '#D7ED9B', 'mpr-coronal': '#57C8CE', 'mpr-sagittal': '#FF6B4A' })[id] ?? '#ffffff',
    getReferenceLineControllable: () => true,
    getReferenceLineDraggableRotatable: () => false,
    getReferenceLineSlabThicknessControlsOn: () => false,
  });

  setPrimaryTool('scroll');
  return getEngine();
}

function addMeasurementTools(g: any) {
  g.addTool(LengthTool.toolName, { getTextLines: lengthText });
  g.addTool(AngleTool.toolName, { getTextLines: angleText });
  g.addTool(CobbAngleTool.toolName, { getTextLines: cobbText, showArcLines: false });
  g.addTool(CircleROITool.toolName, { getTextLines: circleText, calculateStats: true });
}

const { MouseBindings, KeyboardBindings } = ToolEnums;

/** Primary mouse button = selected tool; wheel = scroll; ctrl/pinch-wheel = zoom; right = zoom; middle = pan. */
export function setPrimaryTool(tool: ToolId) {
  const g = ToolGroupManager.getToolGroup(MAIN_TOOLGROUP);
  if (!g) return;
  const all = [StackScrollTool, WindowLevelTool, ZoomTool, PanTool, LengthTool, AngleTool, CobbAngleTool, CircleROITool].map((T) => T.toolName);
  for (const n of all) g.setToolPassive(n, { removeAllBindings: true } as any);
  const primary = TOOL_NAMES[tool];
  const bindings: Record<string, any[]> = {};
  const add = (n: string, b: any) => (bindings[n] = [...(bindings[n] ?? []), b]);
  if (primary) add(primary, { mouseButton: MouseBindings.Primary });
  add(StackScrollTool.toolName, { mouseButton: MouseBindings.Wheel });
  add(ZoomTool.toolName, { mouseButton: MouseBindings.Wheel, modifierKey: KeyboardBindings.Ctrl });
  if (primary !== ZoomTool.toolName) add(ZoomTool.toolName, { mouseButton: MouseBindings.Secondary });
  if (primary !== PanTool.toolName) add(PanTool.toolName, { mouseButton: MouseBindings.Auxiliary });
  add(WindowLevelTool.toolName, { mouseButton: MouseBindings.Primary, modifierKey: KeyboardBindings.Shift });
  for (const [n, b] of Object.entries(bindings)) g.setToolActive(n, { bindings: b });
  // Mask/crop tool: measurement tools stay passive (editable), our own overlay handles input.
}

export function setMprTools() {
  const g = ToolGroupManager.getToolGroup(MPR_TOOLGROUP)!;
  g.setToolActive(CrosshairsTool.toolName, { bindings: [{ mouseButton: MouseBindings.Primary }] });
  g.setToolActive(StackScrollTool.toolName, { bindings: [{ mouseButton: MouseBindings.Wheel }] });
  g.setToolActive(ZoomTool.toolName, { bindings: [{ mouseButton: MouseBindings.Secondary }, { mouseButton: MouseBindings.Wheel, modifierKey: KeyboardBindings.Ctrl }] });
  g.setToolActive(PanTool.toolName, { bindings: [{ mouseButton: MouseBindings.Auxiliary }] });
  g.setToolActive(WindowLevelTool.toolName, { bindings: [{ mouseButton: MouseBindings.Primary, modifierKey: KeyboardBindings.Shift }] });
}

export function setMprPrimary(tool: 'crosshairs' | 'window' | 'zoom' | 'pan') {
  const g = ToolGroupManager.getToolGroup(MPR_TOOLGROUP)!;
  const names = { crosshairs: CrosshairsTool.toolName, window: WindowLevelTool.toolName, zoom: ZoomTool.toolName, pan: PanTool.toolName };
  for (const n of Object.values(names)) g.setToolPassive(n, { removeAllBindings: true } as any);
  setMprTools();
  if (tool !== 'crosshairs') {
    g.setToolPassive(CrosshairsTool.toolName, { removeAllBindings: true } as any);
    g.setToolActive(names[tool], { bindings: [{ mouseButton: MouseBindings.Primary }] });
  }
}

export { eventTarget };
