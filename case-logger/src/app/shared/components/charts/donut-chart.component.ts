import { Component, computed, input } from '@angular/core';

export interface DonutSegment {
  label: string;
  value: number;
  color: string;
}

interface PlottedSegment extends DonutSegment {
  dashArray: string;
  dashOffset: number;
  percent: number;
}

const RADIUS = 48;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const GAP = 3;

@Component({
  selector: 'app-donut-chart',
  standalone: true,
  templateUrl: './donut-chart.component.html',
  styleUrl: './donut-chart.component.scss',
})
export class DonutChartComponent {
  readonly segments = input<DonutSegment[]>([]);
  readonly centerLabel = input<string>('Total');

  readonly radius = RADIUS;
  readonly circumference = CIRCUMFERENCE;

  readonly total = computed(() => this.segments().reduce((sum, s) => sum + s.value, 0));

  readonly plotted = computed<PlottedSegment[]>(() => {
    const total = this.total();
    if (total <= 0) {
      return [];
    }
    let cumulative = 0;
    return this.segments().map((s) => {
      const fraction = s.value / total;
      const length = Math.max(fraction * CIRCUMFERENCE - GAP, 0);
      const offset = -(cumulative * CIRCUMFERENCE);
      cumulative += fraction;
      return {
        ...s,
        percent: Math.round(fraction * 100),
        dashArray: `${length} ${CIRCUMFERENCE - length}`,
        dashOffset: offset,
      };
    });
  });
}
