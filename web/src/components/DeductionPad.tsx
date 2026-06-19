import { useCallback, useEffect, useRef, useState } from "react";
import { deductionsForPreset, type DeductionPresetMode } from "@gym/shared";

type Props = {
  mode: DeductionPresetMode;
  disabled?: boolean;
  /** Max sum of additional deduction amounts allowed before execution would go below 0. Omit = no cap. */
  maxAdditionalDeduction?: number;
  /** Running deduction total (shown on calculator display). */
  deductionTotal?: number;
  /** Execution score after deductions (shown on calculator display). */
  executionScore?: number;
  onDeduction: (amount: number) => void;
};

function formatDeductionLabel(amount: number) {
  return `−${amount.toFixed(2).replace(/\.?0+$/, "") || "0"}`;
}

function formatScore(value: number) {
  return value.toFixed(3);
}

export function DeductionPad({
  mode,
  disabled,
  maxAdditionalDeduction,
  deductionTotal,
  executionScore,
  onDeduction,
}: Props) {
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
      setLastTapLabel(label);
      if (pulseTimer.current) clearTimeout(pulseTimer.current);
      if (labelTimer.current) clearTimeout(labelTimer.current);
      pulseTimer.current = setTimeout(() => setPulseAmount(null), 450);
      labelTimer.current = setTimeout(() => setLastTapLabel(null), 2200);
      onDeduction(amount);
    },
    [onDeduction],
  );

  const showDisplay =
    typeof deductionTotal === "number" && typeof executionScore === "number";

  return (
    <div className="calc-pad" style={{ touchAction: "manipulation" }}>
      {showDisplay ? (
        <div className="calc-pad-display" aria-label="Score display">
          <div className="calc-pad-display-primary">
            <span className="calc-pad-display-label">Execution</span>
            <span className="calc-pad-display-value calc-pad-display-value--exec">
              {formatScore(executionScore)}
            </span>
          </div>
          <div className="calc-pad-display-secondary">
            <span className="calc-pad-display-label">Deductions</span>
            <span className="calc-pad-display-value">{formatScore(deductionTotal)}</span>
          </div>
          <div className="calc-pad-display-status" aria-live="polite" aria-atomic="true">
            {lastTapLabel ? (
              <span className="calc-pad-display-last">
                Last tap <strong>{lastTapLabel}</strong>
              </span>
            ) : (
              <span className="calc-pad-display-hint">Tap a key to add a deduction</span>
            )}
          </div>
        </div>
      ) : (
        <div className="calc-pad-live" aria-live="polite" aria-atomic="true">
          {lastTapLabel ? (
            <span className="calc-pad-live-text">{lastTapLabel} · sent</span>
          ) : null}
        </div>
      )}

      <div className="calc-pad-keys" role="group" aria-label={`Deduction keys (${mode.replace("_", " ")})`}>
        {amounts.map((amount, index) => {
          const label = formatDeductionLabel(amount);
          const pulsing = pulseAmount === amount;
          const overCap =
            typeof maxAdditionalDeduction === "number" && amount > maxAdditionalDeduction + 1e-9;
          const isLastRowPair = amounts.length === 5 && index >= 3;
          return (
            <button
              key={amount}
              type="button"
              className={`calc-pad-key${pulsing ? " calc-pad-key--pulse" : ""}${
                isLastRowPair ? " calc-pad-key--wide" : ""
              }`}
              disabled={disabled || overCap}
              onClick={() => onTap(amount)}
              aria-label={`Apply deduction ${label}`}
            >
              <span className="calc-pad-key-value">{label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
