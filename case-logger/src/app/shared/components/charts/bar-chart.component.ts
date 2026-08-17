import { Component, computed, input, ChangeDetectionStrategy } from '@angular/core';

const WIDTH = 560;
const HEIGHT = 200;
const PAD_LEFT = 34;
const PAD_RIGHT = 12;
const PAD_TOP = 10;
const PAD_BOTTOM = 26;
const BAR_MAX_WIDTH = 24;

interface PlottedBar {
  label: string;
  value: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

@Component({
  selector: 'app-bar-chart',
  standalone: true,
  templateUrl: './bar-chart.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './bar-chart.component.scss',
})
export class BarChartComponent {
  readonly labels = input<string[]>([]);
  readonly values = input<number[]>([]);
  readonly color = input<string>('var(--series-blue)');

  readonly viewBox = `0 0 ${WIDTH} ${HEIGHT}`;
  readonly plotWidth = WIDTH - PAD_LEFT - PAD_RIGHT;
  readonly plotHeight = HEIGHT - PAD_TOP - PAD_BOTTOM;
  readonly padLeft = PAD_LEFT;
  readonly bottomY = PAD_TOP + this.plotHeight;

  readonly maxValue = computed(() => {
    const max = Math.max(1, ...this.values());
    const step = max <= 10 ? 2 : max <= 50 ? 10 : Math.ceil(max / 5 / 50) * 50 || 50;
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

  readonly bars = computed<PlottedBar[]>(() => {
    const max = this.maxValue();
    const n = this.labels().length;
    if (n === 0) {
      return [];
    }
    const slot = this.plotWidth / n;
    const barWidth = Math.min(BAR_MAX_WIDTH, slot * 0.5);
    return this.labels().map((label, i) => {
      const value = this.values()[i] ?? 0;
      const height = (value / max) * this.plotHeight;
      const x = PAD_LEFT + slot * i + (slot - barWidth) / 2;
      const y = PAD_TOP + this.plotHeight - height;
      return { label, value, x, y, width: barWidth, height };
    });
  });

  readonly xLabelPositions = computed(() => {
    const n = this.labels().length;
    const slot = this.plotWidth / (n || 1);
    return this.labels().map((_, i) => PAD_LEFT + slot * i + slot / 2);
  });
}
