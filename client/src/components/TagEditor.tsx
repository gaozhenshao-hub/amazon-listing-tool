import { useState, useRef } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { X, Plus, Tag } from "lucide-react";

interface TagEditorProps {
  tags: string[];
  onChange: (tags: string[]) => void;
  placeholder?: string;
  maxTags?: number;
  suggestions?: string[];
  disabled?: boolean;
  size?: "sm" | "md";
}

export function TagEditor({
  tags,
  onChange,
  placeholder = "添加标签...",
  maxTags = 20,
  suggestions = [],
  disabled = false,
  size = "sm",
}: TagEditorProps) {
  const [inputValue, setInputValue] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const addTag = (tag: string) => {
    const trimmed = tag.trim();
    if (!trimmed || tags.includes(trimmed) || tags.length >= maxTags) return;
    onChange([...tags, trimmed]);
    setInputValue("");
    setShowSuggestions(false);
  };

  const removeTag = (index: number) => {
    onChange(tags.filter((_, i) => i !== index));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addTag(inputValue);
    } else if (e.key === "Backspace" && !inputValue && tags.length > 0) {
      removeTag(tags.length - 1);
    }
  };

  const filteredSuggestions = suggestions.filter(
    (s) => s.toLowerCase().includes(inputValue.toLowerCase()) && !tags.includes(s)
  );

  const tagSize = size === "sm" ? "text-xs py-0 px-1.5 h-5" : "text-sm py-0.5 px-2 h-6";
  const inputSize = size === "sm" ? "h-7 text-xs" : "h-8 text-sm";

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {tags.map((tag, i) => (
          <Badge key={i} variant="secondary" className={`${tagSize} gap-1 font-normal`}>
            <Tag className="h-3 w-3 opacity-50" />
            {tag}
            {!disabled && (
              <button
                onClick={() => removeTag(i)}
                className="ml-0.5 hover:text-destructive transition-colors"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </Badge>
        ))}
      </div>
      {!disabled && tags.length < maxTags && (
        <div className="relative">
          <div className="flex gap-1.5">
            <Input
              ref={inputRef}
              value={inputValue}
              onChange={(e) => {
                setInputValue(e.target.value);
                setShowSuggestions(true);
              }}
              onKeyDown={handleKeyDown}
              onFocus={() => setShowSuggestions(true)}
              onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
              placeholder={placeholder}
              className={inputSize}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => addTag(inputValue)}
              disabled={!inputValue.trim()}
              className="h-7 px-2"
            >
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </div>
          {showSuggestions && inputValue && filteredSuggestions.length > 0 && (
            <div className="absolute z-50 top-full mt-1 w-full bg-popover text-popover-foreground border rounded-md shadow-md max-h-32 overflow-y-auto">
              {filteredSuggestions.slice(0, 8).map((s) => (
                <button
                  key={s}
                  className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent hover:text-accent-foreground transition-colors"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    addTag(s);
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
