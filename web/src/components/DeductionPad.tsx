import { useCallback, useEffect, useRef, useState } from "react";
import { deductionsForPreset, type DeductionPresetMode } from "@gym/shared";

type Props = {
  mode: DeductionPresetMode;
  disabled?: boolean;
  /** Max sum of additional deduction amounts allowed before execution would go below 0. Omit = no cap. */
  maxAdditionalDeduction?: number;
  onDeduction: (amount: number) => void;
};

function formatDeductionLabel(amount: number) {
  return `−${amount.toFixed(2).replace(/\.?0+$/, "") || "0"}`;
}

export function DeductionPad({ mode, disabled, maxAdditionalDeduction, onDeduction }: Props) {
  const amounts = deductionsForPreset(mode);
  const [pulseAmount, setPulseAmount] = useState<number | null>(null);
  const [lastTapLabel, setLastTapLabel] = useState<string | null>(null);
  const pulseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const labelTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (pulseTimer.current) clearTimeout(pulseTimer.current);
      if (labelTimer.current) clearTimeout(labelTimer.current);
    };
  }, []);

  const onTap = useCallback(
    (amount: number) => {
      const label = formatDeductionLabel(amount);
      setPulseAmount(amount);
      setLastTapLabel(`${label} · sent`);
      if (pulseTimer.current) clearTimeout(pulseTimer.current);
      if (labelTimer.current) clearTimeout(labelTimer.current);
      pulseTimer.current = setTimeout(() => setPulseAmount(null), 450);
      labelTimer.current = setTimeout(() => setLastTapLabel(null), 2200);
      onDeduction(amount);
    },
    [onDeduction],
  );

  return (
    <div className="deduction-pad">
      <div className="deduction-pad-grid" style={{ touchAction: "manipulation" }}>
        {amounts.map((amount) => {
          const label = formatDeductionLabel(amount);
          const pulsing = pulseAmount === amount;
          const overCap =
            typeof maxAdditionalDeduction === "number" && amount > maxAdditionalDeduction + 1e-9;
          return (
            <button
              key={amount}
              type="button"
              className={`deduction-pad-btn${pulsing ? " deduction-pad-btn-pulse" : ""}`}
              disabled={disabled || overCap}
              onClick={() => onTap(amount)}
              aria-label={`Apply deduction ${label}`}
            >
              {label}
            </button>
          );
        })}
      </div>
      <div className="deduction-pad-live" aria-live="polite" aria-atomic="true">
        {lastTapLabel ? <span className="deduction-pad-live-text">{lastTapLabel}</span> : null}
      </div>
    </div>
  );
}
