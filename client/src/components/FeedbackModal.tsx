import { useState } from "react";
import { ExternalLink, Star, X } from "lucide-react";
import { useToast } from "./Toast";
import { apiJson } from "../lib/api";

interface FeedbackModalProps {
  orderId: string;
  tableNumber: string;
  restaurantSlug?: string;
  restaurantName: string;
  googleReviewUrl?: string;
  onClose: () => void;
}

export function FeedbackModal({
  orderId,
  tableNumber,
  restaurantSlug,
  restaurantName,
  googleReviewUrl,
  onClose,
}: FeedbackModalProps) {
  const { toast } = useToast();
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [step, setStep] = useState<"rate" | "google">("rate");

  const submitFeedback = async () => {
    if (rating === 0) return;
    setSubmitting(true);
    try {
      await apiJson("/api/public/feedback", {
        method: "POST",
        body: JSON.stringify({
          orderId,
          tableNumber,
          rating,
          comment: comment.trim(),
          ...(restaurantSlug ? { restaurant: restaurantSlug } : {}),
        }),
      });
      if (rating >= 4 && googleReviewUrl) {
        if (comment.trim()) {
          navigator.clipboard?.writeText(comment.trim()).catch(() => {});
        }
        setStep("google");
      } else {
        toast({ title: "Thank you for your feedback!", variant: "success" });
        onClose();
      }
    } catch {
      toast({ title: "Could not submit review", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/55 backdrop-blur-[3px] flex items-center justify-center p-4">
      <div className="bg-[var(--qm-card)] w-full max-w-sm rounded-3xl border border-[var(--qm-line)] p-7 text-center shadow-2xl relative">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute top-4 right-4 h-8 w-8 rounded-full hover:bg-[var(--qm-surface)] flex items-center justify-center"
        >
          <X className="h-4 w-4" />
        </button>

        {step === "google" && googleReviewUrl ? (
          <div className="space-y-4">
            <div className="flex justify-center gap-1">
              {[1, 2, 3, 4, 5].map((n) => (
                <Star
                  key={n}
                  style={n <= rating ? { color: "var(--qm-accent)", fill: "var(--qm-accent)" } : undefined}
                  className={`h-5 w-5 ${n <= rating ? "" : "text-[var(--qm-line)]"}`}
                />
              ))}
            </div>
            <h2 className="font-display text-3xl text-[var(--qm-accent)]">Thank you!</h2>
            <p className="text-sm text-[var(--qm-muted)] leading-relaxed">
              Would you share this on Google? It takes a moment and helps others discover{" "}
              {restaurantName}.
            </p>
            <a
              href={googleReviewUrl}
              target="_blank"
              rel="noreferrer"
              onClick={onClose}
              style={{
                backgroundColor: "var(--qm-accent)",
                color: "var(--qm-accent-ink)",
              }}
              className="w-full h-11 rounded-2xl font-semibold text-sm inline-flex items-center justify-center gap-2"
            >
              Review on Google
              <ExternalLink className="h-4 w-4" />
            </a>
            <button
              type="button"
              onClick={onClose}
              className="w-full h-9 text-xs text-[var(--qm-muted)] hover:text-[var(--qm-accent)]"
            >
              Not now
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <h2 className="font-display text-3xl text-[var(--qm-accent)]">How was your meal?</h2>
              <p className="text-xs text-[var(--qm-muted)] mt-1">
                Your rating goes straight to {restaurantName}.
              </p>
            </div>

            <div className="flex justify-center gap-2 py-2">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setRating(n)}
                  aria-label={`Rate ${n} stars`}
                  className="p-1 transition-transform hover:scale-110"
                >
                  <Star
                    style={n <= rating ? { color: "var(--qm-accent)", fill: "var(--qm-accent)" } : undefined}
                    className={`h-8 w-8 ${n <= rating ? "" : "text-[var(--qm-line)]"}`}
                  />
                </button>
              ))}
            </div>

            <textarea
              rows={3}
              value={comment}
              onChange={(e) => setComment(e.target.value.slice(0, 500))}
              placeholder="Anything you'd like to tell us? (optional)"
              className="w-full p-3.5 rounded-2xl border border-[var(--qm-line)] bg-[var(--qm-bg)] text-sm resize-none focus:outline-none focus:ring-2 focus:ring-[var(--qm-accent)]"
            />

            <div className="space-y-2">
              <button
                type="button"
                disabled={rating === 0 || submitting}
                onClick={submitFeedback}
                style={{
                  backgroundColor: "var(--qm-accent)",
                  color: "var(--qm-accent-ink)",
                }}
                className="w-full h-11 rounded-2xl disabled:opacity-45 font-semibold text-sm"
              >
                {submitting ? "Submitting..." : "Submit Review"}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="w-full h-9 text-xs text-[var(--qm-muted)] hover:text-[var(--qm-accent)]"
              >
                Maybe later
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
