function wave(amplitude: number, cycles: number, phase: number): string {
  let d = "M0 200";
  for (let x = 0; x <= 2880; x += 20) {
    const y =
      200 +
      amplitude *
        Math.sin((x / 1440) * cycles * 2 * Math.PI + phase) *
        Math.sin((x / 1440) * 2 * Math.PI + phase);
    d += ` L${x} ${y.toFixed(1)}`;
  }
  return d;
}

function ribbon(
  count: number,
  amplitude: number,
  cycles: number,
  phase: number,
  opacity: number,
) {
  return Array.from({ length: count }, (_, i) => ({
    key: i,
    d: wave(amplitude * (0.5 + i / count), cycles, phase + i * 0.16),
    strokeOpacity: (opacity * (0.35 + (0.65 * i) / count)).toFixed(2),
  }));
}

const LAYER_ONE = ribbon(16, 60, 3, 0, 0.5);
const LAYER_TWO = ribbon(10, 42, 2, 2, 0.28);

function Ribbon({ paths }: { paths: ReturnType<typeof ribbon> }) {
  return (
    <svg viewBox="0 0 2880 400" preserveAspectRatio="none" fill="none">
      {paths.map((path) => (
        <path
          key={path.key}
          d={path.d}
          strokeOpacity={path.strokeOpacity}
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  );
}

export function Background() {
  return (
    <div className="bg" aria-hidden="true">
      <div className="waves">
        <Ribbon paths={LAYER_ONE} />
        <Ribbon paths={LAYER_TWO} />
      </div>
    </div>
  );
}
