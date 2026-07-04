import { motion } from "framer-motion";

const TypingIndicator = () => {
  return (
    <div className="flex justify-start">
      <div className="bg-card border border-border rounded-2xl rounded-bl-md px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gradient-to-br from-accent to-primary flex items-center justify-center">
            <span className="text-sm">🌊</span>
          </div>
          <div className="flex gap-1">
            {[0, 1, 2].map((i) => (
              <motion.div
                key={i}
                className="w-2 h-2 rounded-full bg-muted-foreground"
                animate={{
                  y: [0, -6, 0],
                }}
                transition={{
                  duration: 0.6,
                  repeat: Infinity,
                  delay: i * 0.15,
                }}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default TypingIndicator;
