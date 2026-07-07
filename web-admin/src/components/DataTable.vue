<script setup lang="ts" generic="TData">
// Headless data grid (D-18, 03-UI-SPEC §Data tables). This wraps
// @tanstack/vue-table — the LIBRARY owns the model (sorting, columns, rows); this
// SFC owns ONLY the markup + tokens: 14px/600 sortable headers with a neutral sort
// caret, 40px rows, Secondary hover, right-aligned tabular numerics (via a column
// `meta.numeric` flag), a per-row status-badge slot, a row-action slot, and
// skeleton rows while loading. Every Wave-2/3 table view feeds it columns + data.
import {
  type ColumnDef,
  FlexRender,
  getCoreRowModel,
  getSortedRowModel,
  type SortingState,
  useVueTable,
} from "@tanstack/vue-table";
import { ChevronDown, ChevronsUpDown, ChevronUp } from "lucide-vue-next";
import { ref } from "vue";

const props = withDefaults(
  defineProps<{
    columns: ColumnDef<TData, unknown>[];
    data: TData[];
    /** Show skeleton rows instead of data while a query is in flight. */
    loading?: boolean;
    /** Number of skeleton rows to render when loading. */
    skeletonRows?: number;
  }>(),
  { loading: false, skeletonRows: 5 },
);

const sorting = ref<SortingState>([]);

const table = useVueTable({
  get data() {
    return props.data;
  },
  get columns() {
    return props.columns;
  },
  state: {
    get sorting() {
      return sorting.value;
    },
  },
  onSortingChange: (updater) => {
    sorting.value = typeof updater === "function" ? updater(sorting.value) : updater;
  },
  getCoreRowModel: getCoreRowModel(),
  getSortedRowModel: getSortedRowModel(),
});

/** A column may opt into right-aligned tabular numerics via meta.numeric. */
function isNumeric(meta: unknown): boolean {
  return Boolean((meta as { numeric?: boolean } | undefined)?.numeric);
}
</script>

<template>
  <div class="overflow-x-auto rounded-lg border border-hairline">
    <table class="w-full border-collapse text-[14px]">
      <thead class="bg-surface">
        <tr
          v-for="headerGroup in table.getHeaderGroups()"
          :key="headerGroup.id"
          class="border-b border-hairline"
        >
          <th
            v-for="header in headerGroup.headers"
            :key="header.id"
            class="h-10 px-md font-semibold text-ink"
            :class="isNumeric(header.column.columnDef.meta) ? 'text-right' : 'text-left'"
          >
            <button
              v-if="!header.isPlaceholder && header.column.getCanSort()"
              type="button"
              class="inline-flex items-center gap-xs hover:text-accent"
              :class="isNumeric(header.column.columnDef.meta) ? 'flex-row-reverse' : ''"
              @click="header.column.getToggleSortingHandler()?.($event)"
            >
              <FlexRender
                :render="header.column.columnDef.header"
                :props="header.getContext()"
              />
              <ChevronUp v-if="header.column.getIsSorted() === 'asc'" :size="14" class="text-muted" />
              <ChevronDown
                v-else-if="header.column.getIsSorted() === 'desc'"
                :size="14"
                class="text-muted"
              />
              <ChevronsUpDown v-else :size="14" class="text-muted" />
            </button>
            <FlexRender
              v-else-if="!header.isPlaceholder"
              :render="header.column.columnDef.header"
              :props="header.getContext()"
            />
          </th>
          <!-- Optional trailing action column header -->
          <th v-if="$slots['row-actions']" class="h-10 px-md text-right font-semibold text-ink" />
        </tr>
      </thead>
      <tbody>
        <!-- Skeleton rows while loading (never a bare white flash — UI-SPEC) -->
        <template v-if="loading">
          <tr
            v-for="n in skeletonRows"
            :key="`sk-${n}`"
            class="h-10 border-b border-hairline last:border-0"
          >
            <td v-for="col in table.getAllLeafColumns()" :key="col.id" class="px-md py-sm">
              <div class="h-3 w-3/4 animate-pulse rounded bg-surface" />
            </td>
            <td v-if="$slots['row-actions']" class="px-md py-sm">
              <div class="h-3 w-8 animate-pulse rounded bg-surface" />
            </td>
          </tr>
        </template>

        <!-- Data rows -->
        <template v-else>
          <tr
            v-for="row in table.getRowModel().rows"
            :key="row.id"
            class="h-10 border-b border-hairline last:border-0 hover:bg-surface"
          >
            <td
              v-for="cell in row.getVisibleCells()"
              :key="cell.id"
              class="px-md py-sm"
              :class="[
                isNumeric(cell.column.columnDef.meta) ? 'text-right tabular' : 'text-left',
              ]"
            >
              <!-- A `cell:<columnId>` slot lets a view render status badges etc. -->
              <slot
                :name="`cell:${cell.column.id}`"
                :row="row.original"
                :value="cell.getValue()"
              >
                <FlexRender :render="cell.column.columnDef.cell" :props="cell.getContext()" />
              </slot>
            </td>
            <td v-if="$slots['row-actions']" class="px-md py-sm text-right">
              <slot name="row-actions" :row="row.original" />
            </td>
          </tr>
        </template>
      </tbody>
    </table>
  </div>
</template>
