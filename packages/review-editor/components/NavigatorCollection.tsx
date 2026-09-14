import React from 'react';
import { ContextMenu } from '@base-ui/react/context-menu';
import type { ReviewNavigatorLayout } from '@plannotator/ui/utils/reviewNavigator';
import { copyTextToClipboard } from '@plannotator/ui/utils/clipboard';
import {
  AnnotationBadge,
  ChangeTypeLetter,
  CommittedDot,
  DiffCounts,
  StageControl,
  ViewedControl,
} from './FileRowBits';
import {
  buildNavigatorTree,
  flatRowDirectory,
  flatRowName,
  type NavigatorFileItem,
  type NavigatorRow,
  type NavigatorTreeNode,
} from '../utils/navigatorModel';

/**
 * One collection of files inside the navigator, drawn in whichever layout the
 * File layout control selects.
 *
 * Every file collection the navigator shows goes through here — the combined
 * All set, the Staged and Unstaged sections, and the files inside an expanded
 * commit row — so a layout change applies uniformly and a row looks the same
 * wherever it appears.
 */

export interface NavigatorRowState {
  isActive: boolean;
  isScrollActive: boolean;
  isViewed: boolean;
  annotationCount: number;
  /** `stage` renders the +/dot control, `committed` the green dot, `spacer`
   * an empty 16px slot so columns line up, `none` nothing at all. */
  stageSlot: 'stage' | 'committed' | 'spacer' | 'none';
  isStaging: boolean;
}

export interface NavigatorCollectionProps<R extends NavigatorRow = NavigatorRow> {
  items: readonly NavigatorFileItem<R>[];
  layout: ReviewNavigatorLayout;
  /** Left inset every row in this collection starts from (px). Commit files
   * nest one level in from the commit row. */
  baseIndent?: number;
  /** Namespaces folder expansion state so the same directory inside two
   * different commits expands independently. */
  keyPrefix: string;
  collapsedFolders: ReadonlySet<string>;
  onToggleFolder: (key: string) => void;
  rowState: (item: NavigatorFileItem<R>) => NavigatorRowState;
  showViewedControls: boolean;
  showStageControls: boolean;
  onSelect: (item: NavigatorFileItem<R>) => void;
  onDoubleClick?: (item: NavigatorFileItem<R>) => void;
  onToggleViewed?: (item: NavigatorFileItem<R>) => void;
  onStage?: (item: NavigatorFileItem<R>) => void;
  /** Absolute repo root for the "Copy full path" context-menu item. */
  repoRoot?: string | null;
  /** Rendered in place of the rows when the collection is empty. */
  emptyLabel?: string;
}

export function navigatorFolderKey(keyPrefix: string, path: string): string {
  return `${keyPrefix}${path}`;
}

const CONTEXT_ITEM_CLASS =
  'flex items-center gap-2 mx-1 px-2 py-1.5 text-xs rounded cursor-pointer outline-none text-foreground/80 data-[highlighted]:bg-muted data-[highlighted]:text-foreground';

function NavigatorFileRow<R extends NavigatorRow>({
  item,
  layout,
  indent,
  state,
  showViewedControls,
  showStageControls,
  onSelect,
  onDoubleClick,
  onToggleViewed,
  onStage,
  repoRoot,
}: {
  item: NavigatorFileItem<R>;
  layout: ReviewNavigatorLayout;
  indent: number;
  state: NavigatorRowState;
  showViewedControls: boolean;
  showStageControls: boolean;
  onSelect: () => void;
  onDoubleClick?: () => void;
  onToggleViewed?: () => void;
  onStage?: () => void;
  repoRoot?: string | null;
}) {
  const { row } = item;
  // Tree rows are already nested under their directory, so both layouts lead
  // with the filename; only the flat layout carries the directory after it.
  const name = flatRowName(row.path);
  const directory = layout === 'flat' ? flatRowDirectory(row.path) : '';

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger
        render={
          <button
            onClick={onSelect}
            onDoubleClick={onDoubleClick}
            title={row.path}
            className={`file-tree-item w-full text-left group ${
              state.isActive ? 'active' : state.isScrollActive ? 'scroll-active' : ''
            } ${state.annotationCount > 0 ? 'has-annotations' : ''}`}
            style={{ paddingLeft: indent }}
          />
        }
      >
        {/* Leading rail: [viewed][stage][letter] then the name. Fixed-width
            slots keep the rail aligned across every section and layout. */}
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          {showViewedControls && <ViewedControl isViewed={state.isViewed} onToggle={onToggleViewed} />}
          {showStageControls && state.stageSlot === 'stage' && (
            <StageControl isStaged={item.staged} isStaging={state.isStaging} onStage={onStage} />
          )}
          {showStageControls && state.stageSlot === 'committed' && <CommittedDot />}
          {showStageControls && state.stageSlot === 'spacer' && (
            <span className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
          )}
          <ChangeTypeLetter status={row.status} oldPath={row.oldPath} untracked={item.untracked} />
          {/* Flat rows lead with the filename and carry the directory as
              quiet secondary text. The directory's outsized shrink factor
              makes it absorb the truncation, so the filename — the part that
              identifies the row — survives a narrow panel; the name still
              shrinks after that rather than overrunning the counts column. */}
          <span className="truncate min-w-0">{name}</span>
          {directory && (
            <span className="truncate min-w-0 shrink-[9999] text-[10px] text-muted-foreground/60">
              {directory}
            </span>
          )}
          <AnnotationBadge count={state.annotationCount} />
        </div>
        <DiffCounts additions={row.additions} deletions={row.deletions} />
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Positioner className="z-50">
          <ContextMenu.Popup className="min-w-[160px] bg-popover text-popover-foreground border border-border rounded shadow-lg overflow-hidden py-1 transition-opacity data-starting-style:opacity-0 data-ending-style:opacity-0">
            <ContextMenu.Item
              onClick={() => {
                void copyTextToClipboard(row.path);
              }}
              className={CONTEXT_ITEM_CLASS}
            >
              Copy path
            </ContextMenu.Item>
            <ContextMenu.Item
              onClick={() => {
                void copyTextToClipboard(name);
              }}
              className={CONTEXT_ITEM_CLASS}
            >
              Copy filename
            </ContextMenu.Item>
            {repoRoot && (
              <ContextMenu.Item
                onClick={() => {
                  void copyTextToClipboard(`${repoRoot.replace(/\/$/, '')}/${row.path}`);
                }}
                className={CONTEXT_ITEM_CLASS}
              >
                Copy full path
              </ContextMenu.Item>
            )}
          </ContextMenu.Popup>
        </ContextMenu.Positioner>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

export function NavigatorCollection<R extends NavigatorRow>(props: NavigatorCollectionProps<R>) {
  const {
    items,
    layout,
    baseIndent = 4,
    keyPrefix,
    collapsedFolders,
    onToggleFolder,
    rowState,
    showViewedControls,
    showStageControls,
    onSelect,
    onDoubleClick,
    onToggleViewed,
    onStage,
    repoRoot,
    emptyLabel,
  } = props;

  const tree = React.useMemo(
    () => (layout === 'tree' ? buildNavigatorTree(items) : []),
    [layout, items],
  );

  if (items.length === 0) {
    return emptyLabel ? (
      <div className="px-2 py-1 text-[11px] text-muted-foreground/50" style={{ paddingLeft: baseIndent + 8 }}>
        {emptyLabel}
      </div>
    ) : null;
  }

  const renderFile = (item: NavigatorFileItem<R>, indent: number) => (
    <NavigatorFileRow
      key={`${keyPrefix}${item.row.path}`}
      item={item}
      layout={layout}
      indent={indent}
      state={rowState(item)}
      showViewedControls={showViewedControls}
      showStageControls={showStageControls}
      onSelect={() => onSelect(item)}
      onDoubleClick={onDoubleClick ? () => onDoubleClick(item) : undefined}
      onToggleViewed={onToggleViewed ? () => onToggleViewed(item) : undefined}
      onStage={onStage ? () => onStage(item) : undefined}
      repoRoot={repoRoot}
    />
  );

  if (layout === 'flat') {
    return <>{items.map((item) => renderFile(item, baseIndent + 4))}</>;
  }

  const renderNodes = (nodes: readonly NavigatorTreeNode<R>[]): React.ReactNode =>
    nodes.map((node) => {
      const indent = baseIndent + node.depth * 8;
      if (node.type === 'file') return renderFile(node.item, indent + 4);
      const key = navigatorFolderKey(keyPrefix, node.path);
      const isExpanded = !collapsedFolders.has(key);
      return (
        <React.Fragment key={`folder:${key}`}>
          <button
            onClick={() => onToggleFolder(key)}
            aria-expanded={isExpanded}
            className="w-full flex items-center gap-1.5 py-1 px-2 text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors rounded-sm"
            style={{ paddingLeft: indent }}
          >
            <svg
              className={`w-3 h-3 flex-shrink-0 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
            <span className="truncate">{node.name}</span>
            {/* Totals on a folder whose only child is a file would just
                restate that row — suppressed (issue #1524). */}
            {!node.redundantTotals && (node.additions > 0 || node.deletions > 0) && (
              <span className="ml-auto flex-shrink-0">
                <DiffCounts additions={node.additions} deletions={node.deletions} />
              </span>
            )}
          </button>
          {isExpanded && renderNodes(node.children)}
        </React.Fragment>
      );
    });

  return <>{renderNodes(tree)}</>;
}
