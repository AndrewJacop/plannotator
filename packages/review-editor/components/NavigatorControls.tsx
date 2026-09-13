import React from 'react';
import type {
  ReviewNavigatorGrouping,
  ReviewNavigatorLayout,
} from '@plannotator/shared/review-navigator';

/**
 * The navigator's two independent segmented controls — File layout and
 * Grouping — rendered as one labelled row under the base-reference selector.
 *
 * They sit in the panel's FIXED toolbar (the list below scrolls past them) and
 * stack vertically once the resizable panel gets narrow, so neither group ever
 * truncates its labels. `stacked` is decided by the caller from the measured
 * panel width rather than a CSS container query, because the panel is a
 * user-resized flex child and container queries would need a named container
 * on a element the dock owns.
 */

const Segment: React.FC<{
  label: string;
  pressed: boolean;
  disabled?: boolean;
  title?: string;
  onSelect: () => void;
}> = ({ label, pressed, disabled, title, onSelect }) => (
  <button
    type="button"
    onClick={onSelect}
    disabled={disabled}
    aria-pressed={pressed}
    title={title}
    className={`min-w-0 flex-none truncate rounded-sm px-2 py-0.5 text-xs leading-none whitespace-nowrap transition-colors ${
      pressed
        ? 'bg-background text-foreground shadow-sm font-medium'
        : 'text-muted-foreground hover:text-foreground'
    } ${disabled ? 'opacity-40 cursor-not-allowed hover:text-muted-foreground' : ''}`}
  >
    {label}
  </button>
);

const ControlGroup: React.FC<{
  id: string;
  label: string;
  grow: number;
  children: React.ReactNode;
}> = ({ id, label, grow, children }) => (
  <div className="min-w-0 flex flex-col gap-0.5" style={{ flex: `${grow} 1 auto` }}>
    <span
      id={id}
      className="text-[10px] uppercase tracking-wide text-muted-foreground leading-none"
    >
      {label}
    </span>
    <div
      role="group"
      aria-labelledby={id}
      className="flex items-center gap-0.5 bg-muted/50 rounded p-0.5"
    >
      {children}
    </div>
  </div>
);

export const NavigatorControls: React.FC<{
  layout: ReviewNavigatorLayout;
  grouping: ReviewNavigatorGrouping;
  onSelectLayout: (layout: ReviewNavigatorLayout) => void;
  onSelectGrouping: (grouping: ReviewNavigatorGrouping) => void;
  /** Set when this session can't group by Git status; explains why. */
  groupingDisabledReason?: string;
  /** Stack the two groups instead of sitting them side by side. */
  stacked?: boolean;
}> = ({ layout, grouping, onSelectLayout, onSelectGrouping, groupingDisabledReason, stacked }) => (
  <div
    className={`px-2 py-1.5 border-b border-border/30 flex gap-2 flex-shrink-0 ${
      stacked ? 'flex-col items-stretch' : 'items-center'
    }`}
    data-navigator-controls
  >
    <ControlGroup id="pn-nav-layout" label="File layout" grow={1}>
      <Segment
        label="Flat"
        pressed={layout === 'flat'}
        title="One row per file, filename first"
        onSelect={() => onSelectLayout('flat')}
      />
      <Segment
        label="Tree"
        pressed={layout === 'tree'}
        title="Expandable directory hierarchy"
        onSelect={() => onSelectLayout('tree')}
      />
    </ControlGroup>
    <ControlGroup id="pn-nav-grouping" label="Grouping" grow={1.7}>
      <Segment
        label="All"
        pressed={grouping === 'all'}
        title="One combined set of changed files"
        onSelect={() => onSelectGrouping('all')}
      />
      <Segment
        label="By Git status"
        pressed={grouping === 'status'}
        disabled={!!groupingDisabledReason}
        title={groupingDisabledReason || 'Staged, Unstaged and Committed sections'}
        onSelect={() => onSelectGrouping('status')}
      />
    </ControlGroup>
  </div>
);
