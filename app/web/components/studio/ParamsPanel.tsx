"use client";

import { useId, type CSSProperties } from "react";
import { NOTE_NAMES, SCALES } from "@gms/shared";
import { GENERATOR_BY_ID, type Field } from "@/lib/generators";
import {
  EFFECT_IDS,
  type EffectId,
  type SharedParams,
  type StudioState,
} from "@/lib/studio-state";

type SharedKey = keyof SharedParams;

type Props = {
  state: StudioState;
  onSharedChange: (key: SharedKey, value: number | string) => void;
  onBlockChange: (key: string, value: number | string) => void;
  onEffectChange: (key: EffectId, value: number) => void;
};

function valueText(value: number, unit?: string): string {
  if (unit === "percent") return `${Math.round(value * 100)} percent`;
  if (unit) return `${value} ${unit}`;
  return String(value);
}

function SliderRow({
  label,
  min,
  max,
  step,
  value,
  unit,
  onChange,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  unit?: string;
  onChange: (value: number) => void;
}) {
  const id = useId();
  const fill = ((value - min) / (max - min)) * 100;
  return (
    <div className="r">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-valuetext={valueText(value, unit)}
        style={{ "--p": `${fill}%` } as CSSProperties}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <output htmlFor={id}>{value}</output>
    </div>
  );
}

function SelectRow({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly (string | number)[];
  value: string | number;
  onChange: (value: number | string) => void;
}) {
  const id = useId();
  const numeric = typeof options[0] === "number";
  return (
    <div className="r">
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        value={String(value)}
        onChange={(event) =>
          onChange(numeric ? Number(event.target.value) : event.target.value)
        }
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </div>
  );
}

function FieldRow({
  field,
  block,
  onBlockChange,
}: {
  field: Field;
  block: Record<string, string | number>;
  onBlockChange: (key: string, value: number | string) => void;
}) {
  if (field.kind === "select") {
    return (
      <SelectRow
        label={field.label}
        options={field.options}
        value={block[field.key]}
        onChange={(value) => onBlockChange(field.key, value)}
      />
    );
  }
  return (
    <SliderRow
      label={field.label}
      min={field.min}
      max={field.max}
      step={field.step}
      value={Number(block[field.key])}
      unit={field.unit}
      onChange={(value) => onBlockChange(field.key, value)}
    />
  );
}

export function ParamsPanel({
  state,
  onSharedChange,
  onBlockChange,
  onEffectChange,
}: Props) {
  const generator = GENERATOR_BY_ID[state.generatorId];
  const block = state.blocks[state.generatorId];

  return (
    <div className="card" id="params">
      <details open>
        <summary>Sound</summary>
        <SliderRow
          label="Tempo"
          min={40}
          max={220}
          step={1}
          value={state.tempo}
          unit="BPM"
          onChange={(value) => onSharedChange("tempo", value)}
        />
        <SelectRow
          label="Root"
          options={NOTE_NAMES}
          value={state.root}
          onChange={(value) => onSharedChange("root", value)}
        />
        <SelectRow
          label="Scale"
          options={SCALES}
          value={state.scale}
          onChange={(value) => onSharedChange("scale", value)}
        />
        <SliderRow
          label="Density"
          min={0}
          max={1}
          step={0.05}
          value={state.density}
          unit="percent"
          onChange={(value) => onSharedChange("density", value)}
        />
        <SliderRow
          label="Swing"
          min={0}
          max={1}
          step={0.05}
          value={state.swing}
          unit="percent"
          onChange={(value) => onSharedChange("swing", value)}
        />
      </details>

      <details open>
        <summary>{generator.name}</summary>
        {generator.fields.map((field) => (
          <FieldRow
            key={field.key}
            field={field}
            block={block}
            onBlockChange={onBlockChange}
          />
        ))}
      </details>

      <details open>
        <summary>Effects</summary>
        {EFFECT_IDS.map((effect) => (
          <SliderRow
            key={effect}
            label={effect}
            min={0}
            max={1}
            step={0.05}
            value={state.effects[effect] ?? 0}
            unit="percent"
            onChange={(value) => onEffectChange(effect, value)}
          />
        ))}
      </details>
    </div>
  );
}
