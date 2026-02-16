//src/services/centros.ts
import { supabase } from '../lib/supabaseClient';

export type Centro = {
    id: number;
    codigo: string;
    ativo: boolean;
    desativado_desde: string | null;
    escopo: 'usinagem' | 'montagem';
    centro_pai_id: number | null;
    exibir_filhos: boolean;
    turnos_op: number; // 1, 2, or 3
    empresa_id: number;
};

export type Alias = {
    id: number;
    alias_texto: string;
    centro_id: number;
    centro?: { id: number; codigo: string } | null;
};

export type CentroSmart = {
    id: number;
    codigo: string;
    ativo?: boolean;
    desativado_desde?: string | null;
    escopo?: 'usinagem' | 'montagem';
    turnos_op?: number;
    empresa_id?: number;
};

export async function fetchCentros(empresaId: number): Promise<Centro[]> {
    const { data, error } = await supabase
        .from('centros')
        .select('id,codigo,ativo,desativado_desde,escopo,centro_pai_id,exibir_filhos,turnos_op,empresa_id')
        .eq('empresa_id', empresaId)
        .order('codigo', { ascending: true });
    if (error) throw error;
    // Default 1 if missing
    return (data ?? []).map((c: any) => ({ ...c, turnos_op: c.turnos_op || 1 })) as Centro[];
}

export async function createCentro(
    codigo: string,
    empresaId: number,
    escopo: 'usinagem' | 'montagem' = 'usinagem',
    turnos_op: number = 1
): Promise<number> {
    const { data, error } = await supabase
        .from('centros')
        .insert({
            codigo: codigo.trim(),
            ativo: true,
            escopo: escopo,
            exibir_filhos: false,
            turnos_op: turnos_op,
            empresa_id: empresaId
        })
        .select('id')
        .single();
    if (error) throw error;
    return data!.id as number;
}

export async function fetchAliases(empresaId: number): Promise<Alias[]> {
    const { data, error } = await supabase
        .from('centro_aliases')
        .select('id, alias_texto, centro_id, centro:centros!inner(id, codigo, empresa_id)')
        .eq('centro.empresa_id', empresaId)
        .order('alias_texto', { ascending: true });
    if (error) throw error;

    // Garante objeto (ou null), nunca array
    const normalized: Alias[] = (data ?? []).map((r: any) => {
        const c = r.centro;
        const centroObj = Array.isArray(c)
            ? (c[0] ? { id: Number(c[0].id), codigo: String(c[0].codigo) } : null)
            : (c ? { id: Number(c.id), codigo: String(c.codigo) } : null);
        return {
            id: Number(r.id),
            alias_texto: String(r.alias_texto),
            centro_id: Number(r.centro_id),
            centro: centroObj,
        };
    });
    return normalized;
}

export async function addAlias(alias_texto: string, centro_id: number) {
    const { error } = await supabase.from('centro_aliases').insert({ alias_texto: alias_texto.trim(), centro_id });
    if (error) throw error;
}

export async function deleteAlias(id: number) {
    const { error } = await supabase.from('centro_aliases').delete().eq('id', id);
    if (error) throw error;
}

export async function fetchCentrosSmart(empresaId: number): Promise<CentroSmart[]> {
    const tryNew = await supabase
        .from('centros')
        .select('id,codigo,desativado_desde,ativo,escopo,empresa_id')
        .eq('empresa_id', empresaId)
        .order('codigo', { ascending: true });

    if (!tryNew.error) return (tryNew.data ?? []) as CentroSmart[];

    // fallback legado (caso a coluna não exista, mas você já rodou o SQL)
    if (tryNew.error?.code === 'PGRST204') {
        const { data, error } = await supabase
            .from('centros')
            .select('id,codigo,ativo')
            .eq('empresa_id', empresaId)
            .order('codigo', { ascending: true });
        if (error) throw error;
        return (data ?? []).map((x: any) => ({ ...x, desativado_desde: null, escopo: 'usinagem' })) as CentroSmart[];
    }
    throw tryNew.error;
}

export async function desativarCentro(centro_id: number, desdeISO: string): Promise<void> {
    // modo novo
    const up = await supabase.from('centros').update({ desativado_desde: desdeISO }).eq('id', centro_id);
    if (!up.error) return;

    // fallback: coluna não existe → seta ativo=false (legado)
    if (up.error?.code === 'PGRST204') {
        const { error } = await supabase.from('centros').update({ ativo: false }).eq('id', centro_id);
        if (error) throw error;
        return;
    }

    throw up.error;
}

export async function reativarCentro(centro_id: number): Promise<void> {
    // modo novo
    const up = await supabase.from('centros').update({ desativado_desde: null }).eq('id', centro_id);
    if (!up.error) return;

    // fallback: legado
    if (up.error?.code === 'PGRST204') {
        const { error } = await supabase.from('centros').update({ ativo: true }).eq('id', centro_id);
        if (error) throw error;
        return;
    }

    throw up.error;
}

export async function fetchCentrosDict(empresaId: number): Promise<Record<number, string>> {
    const { data, error } = await supabase
        .from('centros')
        .select('id,codigo')
        .eq('empresa_id', empresaId);
    if (error) throw error;
    const dict: Record<number, string> = {};
    (data ?? []).forEach((r: any) => (dict[Number(r.id)] = String(r.codigo)));
    return dict;
}
