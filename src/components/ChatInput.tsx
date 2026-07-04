import { useState, KeyboardEvent, useEffect, useRef } from "react";
import { Send, MapPin, AtSign } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { supabase } from "@/integrations/supabase/client";

interface ChatInputProps {
  onSend: (message: string) => void;
  disabled?: boolean;
}

interface Prediction {
  description: string;
  place_id: string;
}

const ChatInput = ({ onSend, disabled }: ChatInputProps) => {
  const [input, setInput] = useState("");
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const containerRef = useRef<HTMLDivElement>(null);

  // Extract the @query from input (text after @ symbol)
  const getAddressQuery = (text: string): string | null => {
    const match = text.match(/@([^@]*)$/);
    return match ? match[1] : null;
  };

  const addressQuery = getAddressQuery(input);
  const isAddressMode = addressQuery !== null;

  // Fetch autocomplete predictions only when in @ mode
  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    // Only search when @ mode is active and query is long enough
    if (!isAddressMode || !addressQuery || addressQuery.length < 2) {
      setPredictions([]);
      setShowSuggestions(false);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      try {
        const { data, error } = await supabase.functions.invoke("places-autocomplete", {
          body: { input: addressQuery },
        });

        if (error) {
          console.error("Autocomplete error:", error);
          return;
        }

        if (data?.predictions) {
          setPredictions(data.predictions);
          setShowSuggestions(data.predictions.length > 0);
          setSelectedIndex(-1);
        }
      } catch (err) {
        console.error("Autocomplete fetch error:", err);
      }
    }, 300);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [isAddressMode, addressQuery]);

  // Close suggestions when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSend = () => {
    if (input.trim() && !disabled) {
      onSend(input.trim());
      setInput("");
      setPredictions([]);
      setShowSuggestions(false);
    }
  };

  const handleSelectPrediction = (description: string) => {
    // Replace @query with the selected address
    const newInput = input.replace(/@[^@]*$/, description);
    setInput(newInput);
    setPredictions([]);
    setShowSuggestions(false);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (showSuggestions && predictions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev < predictions.length - 1 ? prev + 1 : 0));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : predictions.length - 1));
      } else if (e.key === "Enter" && selectedIndex >= 0) {
        e.preventDefault();
        handleSelectPrediction(predictions[selectedIndex].description);
        return;
      } else if (e.key === "Escape") {
        setShowSuggestions(false);
        setSelectedIndex(-1);
      }
    }

    if (e.key === "Enter" && !e.shiftKey && selectedIndex < 0) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div ref={containerRef} className="relative">
      {/* Autocomplete suggestions */}
      {showSuggestions && predictions.length > 0 && (
        <div className="absolute bottom-full left-0 right-0 mb-2 bg-card border border-border rounded-xl shadow-lg overflow-hidden z-50">
          <div className="p-2 text-xs text-muted-foreground border-b border-border flex items-center gap-1.5">
            <MapPin className="w-3 h-3" />
            Address suggestions
          </div>
          <ul className="max-h-60 overflow-y-auto">
            {predictions.map((prediction, index) => (
              <li
                key={prediction.place_id}
                onClick={() => handleSelectPrediction(prediction.description)}
                className={`px-4 py-3 cursor-pointer transition-colors text-sm ${
                  index === selectedIndex
                    ? "bg-accent text-accent-foreground"
                    : "hover:bg-accent/50"
                }`}
              >
                <div className="flex items-start gap-2">
                  <MapPin className="w-4 h-4 mt-0.5 text-muted-foreground shrink-0" />
                  <span>{prediction.description}</span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex gap-3 items-end">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="relative flex-1">
                <Textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  onFocus={() => predictions.length > 0 && setShowSuggestions(true)}
                  placeholder="Type @ to activate address autocomplete..."
                  disabled={disabled}
                  className="min-h-[52px] max-h-32 resize-none bg-input border-border focus:border-ring pr-10"
                  rows={1}
                />
                <AtSign className={`absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none transition-all duration-300 ${isAddressMode ? 'text-primary scale-110 animate-pulse' : 'text-muted-foreground'}`} />
              </div>
            </TooltipTrigger>
            <TooltipContent side="top">
              <p className="text-xs">Type <span className="font-semibold">@</span> to activate address autocomplete</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <Button
          onClick={handleSend}
          disabled={disabled || !input.trim()}
          size="icon"
          className="h-[52px] w-[52px] shrink-0"
        >
          <Send className="h-5 w-5" />
        </Button>
      </div>
    </div>
  );
};

export default ChatInput;
