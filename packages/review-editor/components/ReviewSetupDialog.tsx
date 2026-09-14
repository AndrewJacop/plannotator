import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import {
  useConfigValue,
  setReviewNavigatorLayout,
  setReviewNavigatorGrouping,
  setReviewDefaultDiffType,
} from '@plannotator/ui/config';
import { TextShimmer } from '@plannotator/ui/components/TextShimmer';
import type { ReviewNavigatorGrouping, ReviewNavigatorLayout } from '@plannotator/ui/utils/reviewNavigator';
import workspacesImg from '@plannotator/ui/assets/workspaces.webp';
import sectionsImg from '@plannotator/ui/assets/review-sections.png';
import treeImg from '@plannotator/ui/assets/review-tree.png';

/**
 * Code-review setup chooser — same shell/structure as the plan app's
 * LookAndFeelAnnouncementDialog. Left: how the review navigator lists changes,
 * as its two independent controls over a preview screenshot. Right: the default
 * diff type (including the composite "All changes"). Footer carries the shared
 * "Workspaces are coming" teaser page.
 *
 * Self-contained: reads/writes the configStore directly so it works both as a
 * first-run dialog and from the Settings panel.
 *
 * Nothing here is coupled: layout, grouping and the default diff are three
 * independent choices, and every combination is valid.
 */

interface ReviewSetupDialogProps {
  isOpen: boolean;
  onDismiss: () => void;
}

const WAITLIST_URL = 'https://plannotator.ai/workspaces';

type DiffChoice = 'since-base' | 'uncommitted' | 'unstaged' | 'staged' | 'merge-base' | 'all';

const DIFF_OPTIONS: { value: DiffChoice; label: string; tag?: string; desc: string }[] = [
  // "All changes" belongs to since-base (the flagship composite); uncommitted
  // keeps its plain name so the two stay distinguishable side by side.
  { value: 'since-base', label: 'All changes', tag: 'New', desc: 'Everything since your branch left main — committed, uncommitted, and untracked.' },
  { value: 'uncommitted', label: 'Uncommitted', desc: "Everything you've changed since your last commit." },
  { value: 'unstaged', label: 'Unstaged', desc: "Only changes you haven't staged yet." },
  { value: 'staged', label: 'Staged', desc: "Only changes you've staged for commit." },
  { value: 'merge-base', label: 'Committed changes (PR view)', desc: 'Commits on this branch vs the base — the literal PR view.' },
  { value: 'all', label: 'All files (HEAD)', desc: 'Every tracked file at HEAD, shown as additions.' },
];

const LAYOUT_OPTIONS: { key: ReviewNavigatorLayout; title: string; desc: string }[] = [
  { key: 'flat', title: 'Flat', desc: 'One row per file, filename first with its directory beside it.' },
  { key: 'tree', title: 'Tree', desc: 'Expandable directories, with per-directory totals.' },
];

const GROUPING_OPTIONS: { key: ReviewNavigatorGrouping; title: string; desc: string }[] = [
  { key: 'all', title: 'All', desc: 'One combined set of changed files.' },
  {
    key: 'status',
    title: 'By Git status',
    desc: 'Staged, Unstaged and Committed — with each commit expandable into its own files.',
  },
];

export const ReviewSetupDialog: React.FC<ReviewSetupDialogProps> = ({ isOpen, onDismiss }) => {
  const [page, setPage] = useState<1 | 2>(1);
  const [zoomed, setZoomed] = useState(false);
  const navigatorLayout = useConfigValue('reviewNavigatorLayout');
  const navigatorGrouping = useConfigValue('reviewNavigatorGrouping');
  const defaultDiffType = useConfigValue('defaultDiffType');

  if (!isOpen) return null;

  const chooseDiff = (value: DiffChoice) => setReviewDefaultDiffType(value);

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background/90 backdrop-blur-sm p-4">
      <div className="bg-card border border-border rounded-xl w-full max-w-5xl h-[800px] max-h-[calc(100vh-2rem)] shadow-2xl flex flex-col">
        {page === 1 ? (
          <>
            {/* Header */}
            <div className="p-7 border-b border-border">
              <h3 className="font-semibold text-2xl mb-1.5">Set up your review view</h3>
              <p className="text-sm text-muted-foreground max-w-3xl">
                A simpler review, closer to what you'd see on GitHub. We recommend the{' '}
                <span className="text-foreground font-medium">Tree</span> layout showing{' '}
                <span className="text-foreground font-medium">All</span> changes, defaulting to{' '}
                <span className="text-foreground font-medium">All changes</span> — every local change
                since <span className="font-mono">origin/main</span>. It isn't a literal PR (only
                committed work lands in one — pick <span className="text-foreground font-medium">Committed changes</span>{' '}
                for that), but it gives you the whole local picture. Layout and grouping are
                independent, and both controls live in the panel itself — switch anytime, or change
                these later in Settings.
              </p>
            </div>

            {/* Body: navigator controls (left) + diff type (right) */}
            <div className="px-7 pt-6 flex-1 min-h-0 flex gap-8">
              <div className="flex-[3] min-w-0 flex flex-col">
                <div className="text-sm font-medium mb-3">Review navigator</div>
                <div className="flex gap-5">
                  <div className="flex-1 min-w-0 space-y-2">
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">File layout</div>
                    {LAYOUT_OPTIONS.map((opt) => {
                      const selected = navigatorLayout === opt.key;
                      return (
                        <button
                          key={opt.key}
                          type="button"
                          onClick={() => setReviewNavigatorLayout(opt.key)}
                          aria-pressed={selected}
                          className={`w-full rounded-lg border p-2.5 text-left transition-colors ${
                            selected ? 'border-primary bg-primary/5' : 'border-border hover:border-muted-foreground/40'
                          }`}
                        >
                          <span className="text-sm font-medium">{opt.title}</span>
                          <span className="block text-xs text-muted-foreground leading-snug mt-0.5">{opt.desc}</span>
                        </button>
                      );
                    })}
                  </div>
                  <div className="flex-1 min-w-0 space-y-2">
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">Grouping</div>
                    {GROUPING_OPTIONS.map((opt) => {
                      const selected = navigatorGrouping === opt.key;
                      return (
                        <button
                          key={opt.key}
                          type="button"
                          onClick={() => setReviewNavigatorGrouping(opt.key)}
                          aria-pressed={selected}
                          className={`w-full rounded-lg border p-2.5 text-left transition-colors ${
                            selected ? 'border-primary bg-primary/5' : 'border-border hover:border-muted-foreground/40'
                          }`}
                        >
                          <span className="text-sm font-medium">{opt.title}</span>
                          <span className="block text-xs text-muted-foreground leading-snug mt-0.5">{opt.desc}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
                {/* One preview of the chosen grouping — hover to enlarge. */}
                <div className="relative mt-4 overflow-visible">
                  <img
                    src={navigatorGrouping === 'status' ? sectionsImg : treeImg}
                    alt={
                      navigatorGrouping === 'status'
                        ? 'Review navigator grouped by Git status'
                        : 'Review navigator showing all changes together'
                    }
                    className="w-full rounded-md select-none object-cover object-top"
                    draggable={false}
                    onMouseEnter={() => setZoomed(true)}
                    onMouseLeave={() => setZoomed(false)}
                    style={{
                      height: 250,
                      border: '2px solid color-mix(in srgb, var(--primary) 25%, transparent)',
                      transform: zoomed ? 'scale(1.35)' : 'scale(1)',
                      transformOrigin: 'top center',
                      zIndex: zoomed ? 50 : 0,
                      position: 'relative',
                      boxShadow: zoomed ? '0 18px 44px rgba(0,0,0,0.45)' : 'none',
                      transition:
                        'transform 0.25s cubic-bezier(0.34,1.56,0.64,1), border-color 0.2s ease, box-shadow 0.2s ease',
                    }}
                  />
                </div>
              </div>

              {/* Right — default diff type */}
              <div className="flex-[2] min-w-0 flex flex-col">
                <div className="text-sm font-medium mb-3">Default diff</div>
                <div className="flex flex-col gap-2 overflow-auto pr-1">
                  {DIFF_OPTIONS.map((opt) => {
                    const selected = defaultDiffType === opt.value;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => chooseDiff(opt.value)}
                        className={`w-full flex items-start gap-3 p-2.5 rounded-lg border text-left transition-colors ${
                          selected ? 'border-primary bg-primary/5' : 'border-border hover:border-muted-foreground/30 hover:bg-muted/40'
                        }`}
                      >
                        <span
                          className={`mt-0.5 w-4 h-4 rounded-full border-2 flex-shrink-0 flex items-center justify-center ${
                            selected ? 'border-primary' : 'border-muted-foreground/40'
                          }`}
                        >
                          {selected && <span className="w-2 h-2 rounded-full bg-primary" />}
                        </span>
                        <span className="min-w-0">
                          <span className="flex items-center gap-2">
                            <span className="text-sm font-medium">{opt.label}</span>
                            {opt.tag && (
                              <span
                                className={`text-[10px] leading-none px-1.5 py-0.5 rounded-full ${
                                  selected ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                                }`}
                              >
                                {opt.tag}
                              </span>
                            )}
                          </span>
                          <span className="block text-xs text-muted-foreground leading-snug mt-0.5">{opt.desc}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="px-7 py-5 border-t border-border flex justify-end items-center gap-4">
              <button
                type="button"
                onClick={() => setPage(2)}
                className="px-4 py-2 rounded-lg border border-primary/35 hover:opacity-80 transition-opacity"
              >
                <TextShimmer className="text-sm font-medium" duration={2.5} spread={1.5}>
                  {'✨ Workspaces are coming 🎉 →'}
                </TextShimmer>
              </button>
              <button
                onClick={onDismiss}
                className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:opacity-90 transition-opacity"
              >
                Got it
              </button>
            </div>
          </>
        ) : (
          <>
            {/* Header */}
            <div className="p-7 border-b border-border">
              <h3 className="font-semibold text-2xl mb-1.5">Workspaces are coming 🎉</h3>
              <p className="text-sm text-muted-foreground">
                A shared context workspace for specs, reviews, and decisions your agents can build
                on. Join the waitlist.
              </p>
            </div>
            <div className="flex-1 min-h-0 p-6 flex items-center justify-center">
              <img
                src={workspacesImg}
                alt="Plannotator Workspaces, a shared context workspace across your agents"
                className="max-h-full max-w-full w-auto object-contain rounded-lg border border-border select-none"
                draggable={false}
              />
            </div>
            <div className="px-7 py-5 border-t border-border flex justify-end items-center gap-4">
              <button
                type="button"
                onClick={() => setPage(1)}
                className="text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                &larr; Back
              </button>
              <a
                href={WAITLIST_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:opacity-90 transition-opacity"
              >
                Join the waitlist
              </a>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body
  );
};
