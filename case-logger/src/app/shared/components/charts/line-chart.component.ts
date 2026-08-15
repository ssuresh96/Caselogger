import { Component, computed, input } from '@angular/core';

export interface LineSeries {
  name: string;
  color: string;
  values: number[];
}

interface PlottedSeries {
  name: string;
  color: string;
  path: string;
  points: { x: number; y: number; value: number }[];
}

const WIDTH = 560;
const HEIGHT = 200;
const PAD_LEFT = 34;
const PAD_RIGHT = 12;
const PAD_TOP = 10;
const PAD_BOTTOM = 26;

@Component({
  selector: 'app-line-chart',
  standalone: true,
  templateUrl: './line-chart.component.html',
  styleUrl: './line-chart.component.scss',
})
export class LineChartComponent {
  readonly labels = input<string[]>([]);
  readonly series = input<LineSeries[]>([]);

  readonly viewBox = `0 0 ${WIDTH} ${HEIGHT}`;
  readonly plotWidth = WIDTH - PAD_LEFT - PAD_RIGHT;
  readonly plotHeight = HEIGHT - PAD_TOP - PAD_BOTTOM;
  readonly padLeft = PAD_LEFT;
  readonly padTop = PAD_TOP;

  readonly maxValue = computed(() => {
    const all = this.series().flatMap((s) => s.values);
    const max = Math.max(1, ...all);
    // round up to a clean step
    const step = max <= 10 ? 2 : max <= 50 ? 10 : Math.ceil(max / 5 / 10) * 10;
    return Math.ceil(max / step) * step || step;
  });

  readonly gridLines = computed(() => {
    const max = this.maxValue();
    const steps = 4;
    return Array.from({ length: steps + 1 }, (_, i) => {
      const value = Math.round((max / steps) * (steps - i));
      const y = PAD_TOP + (this.plotHeight / steps) * i;
      return { value, y };
    });
  });

  readonly xPositions = computed(() => {
    const n = this.labels().length;
    if (n <= 1) {
      return [PAD_LEFT];
    }
    return this.labels().map((_, i) => PAD_LEFT + (this.plotWidth / (n - 1)) * i);
  });

  readonly plotted = computed<PlottedSeries[]>(() => {
    const max = this.maxValue();
    const xs = this.xPositions();
    return this.series().map((s) => {
      const points = s.values.map((value, i) => ({
        x: xs[i] ?? PAD_LEFT,
        y: PAD_TOP + this.plotHeight - (value / max) * this.plotHeight,
        value,
      }));
      const path = points
        .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
        .join(' ');
      return { name: s.name, color: s.color, path, points };
    });
  });

  readonly bottomY = PAD_TOP + this.plotHeight;
}
