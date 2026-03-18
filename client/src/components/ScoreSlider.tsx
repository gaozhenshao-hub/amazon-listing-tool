import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Star, Save } from "lucide-react";

interface ScoreSliderProps {
  value: number;
  onChange: (value: number) => void;
  onSave?: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  label?: string;
  disabled?: boolean;
  showSave?: boolean;
  size?: "sm" | "md";
}

export function ScoreSlider({
  value,
  onChange,
  onSave,
  min = 1,
  max = 10,
  step = 1,
  label = "评分",
  disabled = false,
  showSave = true,
  size = "sm",
}: ScoreSliderProps) {
  const [isDirty, setIsDirty] = useState(false);

  const percentage = ((value - min) / (max - min)) * 100;

  const getColor = () => {
    if (max <= 10) {
      if (value >= 8) return "text-green-500";
      if (value >= 5) return "text-amber-500";
      return "text-red-500";
    } else {
      if (value >= 80) return "text-green-500";
      if (value >= 50) return "text-amber-500";
      return "text-red-500";
    }
  };

  const getBgGradient = () => {
    if (max <= 10) {
      if (value >= 8) return "from-green-500 to-green-400";
      if (value >= 5) return "from-amber-500 to-amber-400";
      return "from-red-500 to-red-400";
    } else {
      if (value >= 80) return "from-green-500 to-green-400";
      if (value >= 50) return "from-amber-500 to-amber-400";
      return "from-red-500 to-red-400";
    }
  };

  const handleChange = (newValue: number) => {
    onChange(newValue);
    setIsDirty(true);
  };

  const handleSave = () => {
    onSave?.(value);
    setIsDirty(false);
  };

  const textSize = size === "sm" ? "text-xs" : "text-sm";
  const scoreSize = size === "sm" ? "text-lg" : "text-2xl";

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className={`${textSize} text-muted-foreground flex items-center gap-1`}>
          <Star className="h-3.5 w-3.5" />
          {label}
        </span>
        <div className="flex items-center gap-2">
          <span className={`${scoreSize} font-bold ${getColor()}`}>{value}</span>
          <span className={`${textSize} text-muted-foreground`}>/ {max}</span>
          {showSave && isDirty && onSave && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleSave}
              disabled={disabled}
              className="h-6 px-2 text-xs gap-1"
            >
              <Save className="h-3 w-3" /> 保存
            </Button>
          )}
        </div>
      </div>
      <div className="relative">
        <div className="h-2 bg-muted rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full bg-gradient-to-r ${getBgGradient()} transition-all duration-200`}
            style={{ width: `${percentage}%` }}
          />
        </div>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => handleChange(Number(e.target.value))}
          disabled={disabled}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
        />
      </div>
      <div className={`flex justify-between ${textSize} text-muted-foreground`}>
        <span>{min}</span>
        <span>{max}</span>
      </div>
    </div>
  );
}
