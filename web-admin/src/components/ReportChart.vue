<script setup lang="ts">
// Reports chart wrapper on vue-chartjs / Chart.js 4 (03-11 / MKT-04, D-24). ONE
// small, self-contained component the Reports view reuses for every chart (bar /
// line / pie). Colours are passed in per-point by the caller from the FIXED
// channel↔color mapping (useReports) so a channel is always the same hue across
// charts. Type voice per UI-SPEC §Charts: title 20px/600, axis + legend 14px.
// Canvas-rendered, no external service (NFR-08).
import {
  ArcElement,
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  Title,
  Tooltip,
} from "chart.js";
import { computed } from "vue";
import { Bar, Line, Pie } from "vue-chartjs";

ChartJS.register(
  Title,
  Tooltip,
  Legend,
  BarElement,
  LineElement,
  PointElement,
  ArcElement,
  CategoryScale,
  LinearScale,
);

const props = withDefaults(
  defineProps<{
    type?: "bar" | "line" | "pie";
    title: string;
    labels: string[];
    values: number[];
    /** Per-point colours (bar/pie). Falls back to the leaf-green accent. */
    colors?: string[];
    /** Dataset label (legend / tooltip). */
    seriesLabel?: string;
    /** Format a raw value for the tooltip (e.g. satang → baht). */
    format?: (v: number) => string;
  }>(),
  { type: "bar", colors: () => [], seriesLabel: "", format: undefined },
);

const ACCENT = "#2E7D32";

const chartData = computed(() => {
  const bg = props.labels.map((_, i) => props.colors[i] ?? ACCENT);
  return {
    labels: props.labels,
    datasets: [
      {
        label: props.seriesLabel || props.title,
        data: props.values,
        backgroundColor: props.type === "line" ? "rgba(46,125,50,0.15)" : bg,
        borderColor: props.type === "line" ? ACCENT : bg,
        borderWidth: props.type === "line" ? 2 : 0,
        fill: props.type === "line",
        tension: 0.3,
        pointBackgroundColor: ACCENT,
      },
    ],
  };
});

const fmt = (v: number) =>
  props.format ? props.format(v) : new Intl.NumberFormat("th-TH").format(v);

// Typed as `any`: one options object is shared across the Bar/Line/Pie components
// whose Chart.js generics differ (bar vs line vs pie tooltip/scale types), so a
// single precisely-typed object cannot satisfy all three. The shape is correct at
// runtime; loosening the static type is the pragmatic seam here.
// biome-ignore lint/suspicious/noExplicitAny: cross-chart-type Chart.js options union
const options = computed<any>(() => ({
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    title: {
      display: true,
      text: props.title,
      font: { size: 20, weight: 600 as const, family: "Sarabun, sans-serif" },
      color: "#1B2A1B",
      padding: { bottom: 16 },
    },
    legend: {
      display: props.type === "pie",
      position: "bottom" as const,
      labels: { font: { size: 14, family: "Sarabun, sans-serif" }, color: "#5B6B5B" },
    },
    tooltip: {
      titleFont: { size: 14, family: "Sarabun, sans-serif" },
      bodyFont: { size: 14, family: "Sarabun, sans-serif" },
      callbacks: {
        // biome-ignore lint/suspicious/noExplicitAny: Chart.js tooltip item differs per chart type
        label: (ctx: any) => {
          const raw = typeof ctx.parsed === "number" ? ctx.parsed : (ctx.parsed?.y ?? 0);
          return `${ctx.label}: ${fmt(Number(raw))}`;
        },
      },
    },
  },
  scales:
    props.type === "pie"
      ? undefined
      : {
          x: { ticks: { font: { size: 14, family: "Sarabun, sans-serif" }, color: "#5B6B5B" } },
          y: {
            beginAtZero: true,
            ticks: {
              font: { size: 14, family: "Sarabun, sans-serif" },
              color: "#5B6B5B",
              callback: (v: number | string) => fmt(Number(v)),
            },
          },
        },
}));
</script>

<template>
  <div class="h-[280px]">
    <Bar v-if="type === 'bar'" :data="chartData" :options="options" />
    <Line v-else-if="type === 'line'" :data="chartData" :options="options" />
    <Pie v-else :data="chartData" :options="options" />
  </div>
</template>
