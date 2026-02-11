export type FactoryDayRow = { iso: string; label: string; produzido: number; meta: number; metaDisplay?: number; pct: number; isSaturday: boolean; };
export type Contribuinte = { codigo: string; real: number; is_stale: boolean; last_ref: string; };

export type CentroPerf = {
    centro_id: number; codigo: string; is_parent: boolean; has_parent: boolean; pinned: boolean;
    meta_dia: number; meta_mes: number;
    real_dia: number; real_mes: number;
    esperado_dia: number; desvio_dia: number;
    ader_dia: number | null; pct_meta_dia: number | null; ader_mes: number | null;
    is_stale: boolean; last_ref_time: string;
    contribuintes: Contribuinte[];
};
