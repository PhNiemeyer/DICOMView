import {
  Angle,
  Circle,
  Contrast,
  Crop,
  DraftingCompass,
  Eye,
  EyeOff,
  Hand,
  Layers,
  Maximize,
  RotateCcw,
  RotateCw,
  Ruler,
  SquareCenterlineDashedHorizontal,
  SquareCenterlineDashedVertical,
  SquareDashed,
  Trash,
  Undo2,
  ZoomIn,
  SunMoon,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useStore } from '../core/store';
import { t, type DictKey } from '../core/i18n';
import { setPrimaryTool, type ToolId } from '../cs/init';
import { CT_PRESETS, defaultWindow, deleteSelectedAnnotations, fit, flip, invert, resetView, rotate, setAllAnnotationsVisible, setWindow } from '../cs/viewportOps';

const ICON = { size: 18, strokeWidth: 1.5 };

const TOOLS: { id: ToolId; icon: ReactNode; label: DictKey; key: string }[] = [
  { id: 'scroll', icon: <Layers {...ICON} />, label: 'tScroll', key: 'S' },
  { id: 'window', icon: <Contrast {...ICON} />, label: 'tWindow', key: 'W' },
  { id: 'zoom', icon: <ZoomIn {...ICON} />, label: 'tZoom', key: 'Z' },
  { id: 'pan', icon: <Hand {...ICON} />, label: 'tPan', key: 'P' },
  { id: 'length', icon: <Ruler {...ICON} />, label: 'tLength', key: 'L' },
  { id: 'angle', icon: <Angle {...ICON} />, label: 'tAngle', key: 'A' },
  { id: 'cobb', icon: <DraftingCompass {...ICON} />, label: 'tCobb', key: 'C' },
  { id: 'circle', icon: <Circle {...ICON} />, label: 'tCircle', key: 'O' },
  { id: 'mask', icon: <SquareDashed {...ICON} />, label: 'tMask', key: 'M' },
];

export function selectTool(id: ToolId) {
  useStore.getState().set({ tool: id, pipette: false });
  if (id !== 'mask' && id !== 'crop') setPrimaryTool(id);
  else setPrimaryTool('scroll');
}

export default function Toolbar() {
  const tool = useStore((s) => s.tool);
  const visible = useStore((s) => s.measurementsVisible);
  useStore((s) => s.settings.lang);

  return (
    <div className="toolbar" role="toolbar" aria-label={t('tools')}>
      <div className="tb-group">
        {TOOLS.map((tl) => (
          <button
            key={tl.id}
            className={`tb-btn ${tool === tl.id ? 'active' : ''}`}
            aria-pressed={tool === tl.id}
            title={`${t(tl.label)} (${tl.key})`}
            onClick={() => selectTool(tl.id)}
          >
            {tl.icon}
            <span>{t(tl.label)}</span>
          </button>
        ))}
      </div>
      <div className="tb-sep" />
      <div className="tb-group">
        <Btn icon={<SunMoon {...ICON} />} label={t('invert')} onClick={invert} hk="I" />
        <Btn icon={<RotateCcw {...ICON} />} label={t('rotateL')} onClick={() => rotate(-90)} />
        <Btn icon={<RotateCw {...ICON} />} label={t('rotateR')} onClick={() => rotate(90)} hk="R" />
        <Btn icon={<SquareCenterlineDashedVertical {...ICON} />} label={t('flipH')} onClick={() => flip('h')} hk="H" />
        <Btn icon={<SquareCenterlineDashedHorizontal {...ICON} />} label={t('flipV')} onClick={() => flip('v')} hk="V" />
        <Btn icon={<Maximize {...ICON} />} label={t('fit')} onClick={fit} hk="F" />
        <Btn icon={<Undo2 {...ICON} />} label={t('reset')} onClick={resetView} hk="0" />
      </div>
      <div className="tb-sep" />
      <div className="tb-group">
        <select
          className="tb-select"
          aria-label={t('presets')}
          value=""
          onChange={(e) => {
            const v = e.target.value;
            if (v === 'default') defaultWindow();
            else {
              const p = CT_PRESETS.find((x) => x.key === v);
              if (p) setWindow(p.ww, p.wl);
            }
            e.currentTarget.blur();
          }}
        >
          <option value="" disabled>
            {t('presets')}
          </option>
          <option value="default">{t('presetDefault')}</option>
          {CT_PRESETS.map((p) => (
            <option key={p.key} value={p.key}>
              {t(p.key as DictKey)} ({p.ww}/{p.wl})
            </option>
          ))}
        </select>
        <Btn
          icon={visible ? <Eye {...ICON} /> : <EyeOff {...ICON} />}
          label={visible ? t('hideMeasurements') : t('showMeasurements')}
          pressed={!visible}
          onClick={() => {
            const v = !visible;
            useStore.getState().set({ measurementsVisible: v });
            setAllAnnotationsVisible(v);
          }}
        />
        <Btn icon={<Trash {...ICON} />} label={t('deleteSelected')} onClick={deleteSelectedAnnotations} hk="⌫" />
        <button className={`tb-btn ${tool === 'crop' ? 'active' : ''}`} aria-pressed={tool === 'crop'} title={t('cropHint')} onClick={() => selectTool('crop')}>
          <Crop {...ICON} />
          <span>{t('tCrop')}</span>
        </button>
      </div>
    </div>
  );
}

function Btn({ icon, label, onClick, hk, pressed }: { icon: ReactNode; label: string; onClick: () => void; hk?: string; pressed?: boolean }) {
  return (
    <button className={`tb-btn icon-only ${pressed ? 'active' : ''}`} title={hk ? `${label} (${hk})` : label} aria-label={label} onClick={onClick}>
      {icon}
    </button>
  );
}
