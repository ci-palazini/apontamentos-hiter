//src/features/tv/TvDashboardPage.tsx
import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ActionIcon, Badge, Card, Group, Loader, Stack, Text, Title, ThemeIcon, Button
} from '@mantine/core';
import {
  IconChevronLeft, IconChevronRight, IconMaximize, IconMinimize, IconTrendingUp,
  IconClock, IconArrowLeft, IconX, IconCalendar, IconCloudUpload // Adicionado IconCloudUpload
} from '@tabler/icons-react';

import { useEmpresaId } from '../../contexts/TenantContext';
import { useTvData } from './hooks/useTvData';
import { formatNum, perfColor } from './utils';
import { SlideFactory } from './components/SlideFactory';
import { SlideMaquinas } from './components/SlideMaquinas';
import { SlideAviso } from './components/SlideAviso';
import { SlideApresentacao } from './components/SlideApresentacao';
import { SlideBranding } from './components/SlideBranding';
import { TickerBar } from './components/TickerBar';

/* ========= PÁGINA PRINCIPAL ========= */
export default function TvDashboardPage() {
  const empresaId = useEmpresaId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const { scope } = useParams();
  const navigate = useNavigate();

  const [isFullscreen, setIsFullscreen] = useState(false);

  const {
    loading,
    factoryDays,
    lastUpdateText,
    dataReferenciaText, // <--- Pegando a nova variável aqui
    contextDia,
    avisos,
    resumo,
    centroPages
  } = useTvData(empresaId, scope);

  // Avisos e Slides
  const [activeSlide, setActiveSlide] = useState(0);
  const [overrideTimer, setOverrideTimer] = useState<number | null>(null);
  const seenAvisosRef = useRef<Set<number>>(new Set());

  // NOVO STATE PARA MODO APRESENTAÇÃO
  const [isPresentationMode, setIsPresentationMode] = useState(false);

  const tickerAvisos = useMemo(() => avisos.filter(a => a.exibir_como === 'ticker'), [avisos]);
  const slideAvisos = useMemo(() => avisos.filter(a => a.exibir_como === 'slide' || a.exibir_como === 'apresentacao'), [avisos]);

  const tituloPainel = useMemo(() => {
    if (scope === 'montagem') return 'Painel de Montagem';
    if (scope === 'usinagem') return 'Painel de Usinagem';
    return 'Painel Geral de Produção';
  }, [scope]);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) rootRef.current?.requestFullscreen?.();
    else document.exitFullscreen?.();
  };

  useEffect(() => {
    const handler = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  // --- LÓGICA DO CARROSSEL (Slides) ---
  const countFactory = 1;
  const countMaquinas = Math.max(centroPages.length, 0);
  const countAvisos = slideAvisos.length;
  const countBranding = 1;
  const totalSlides = countFactory + countMaquinas + countAvisos + countBranding;

  // 1. SEGURANÇA: Se o número de slides diminuir (ex: removeu aviso) e estourar o índice, volta pro zero
  useEffect(() => {
    if (totalSlides > 0 && activeSlide >= totalSlides) {
      setActiveSlide(0);
      setOverrideTimer(null); // Reseta timer se perdeu a referência
    }
  }, [totalSlides, activeSlide]);

  // 2. DETECÇÃO DE NOVO ALERTA (Interrupção)
  useEffect(() => {
    // Procura um aviso slide/apresentação que ainda não foi visto nesta sessão
    const novoAviso = avisos.find(a => !seenAvisosRef.current.has(a.id) && (a.exibir_como === 'slide' || a.exibir_como === 'apresentacao'));

    if (novoAviso) {
      seenAvisosRef.current.add(novoAviso.id);

      const slideIndex = slideAvisos.findIndex(a => a.id === novoAviso.id);
      if (slideIndex >= 0) {
        const absoluteIndex = countFactory + countMaquinas + slideIndex;

        setActiveSlide(absoluteIndex);

        // Define timer: 1 hora para apresentação, 20s para avisos comuns
        const tempo = novoAviso.exibir_como === 'apresentacao' ? 3600000 : 20000;
        setOverrideTimer(tempo);

        // Se for apresentação, já ativa o modo
        if (novoAviso.exibir_como === 'apresentacao') {
          setIsPresentationMode(true);
        }
      }
    }
  }, [avisos, slideAvisos, countFactory, countMaquinas]);

  // 3. SINCRONIA DE ESTADO (Corrige o bug do timer travado)
  // Verifica o que está sendo exibido AGORA e ajusta o modo/timer
  useEffect(() => {
    if (totalSlides === 0) return;

    // Calcula qual aviso está na tela agora (se houver)
    const avisoIndex = activeSlide - countFactory - countMaquinas;
    const isAvisoSlide = avisoIndex >= 0 && avisoIndex < countAvisos;
    const avisoAtual = isAvisoSlide ? slideAvisos[avisoIndex] : null;

    // Verifica se é uma apresentação válida
    const isShowingPresentation = avisoAtual?.exibir_como === 'apresentacao' && !!avisoAtual.arquivo_url;

    if (isShowingPresentation) {
      // Se é apresentação mas o modo tá desligado, Liga.
      if (!isPresentationMode) setIsPresentationMode(true);
    } else {
      // Se NÃO é apresentação (ex: foi removido ou mudou o slide), mas o modo tá ligado OU o timer tá gigante
      if (isPresentationMode || (overrideTimer && overrideTimer > 20000)) {
        setIsPresentationMode(false);
        setOverrideTimer(null); // <--- AQUI ESTÁ A CORREÇÃO: Mata o timer de 1 hora
      }
    }
  }, [activeSlide, totalSlides, countFactory, countMaquinas, countAvisos, slideAvisos, isPresentationMode, overrideTimer]);

  // 4. ROTAÇÃO AUTOMÁTICA (Carrossel)
  useEffect(() => {
    if (totalSlides <= 1) return;

    // Se estiver em modo apresentação (timer longo), não roda o carrossel padrão curto
    // A duração vem do overrideTimer ou do padrão
    let duration = 12000; // Padrão

    if (overrideTimer) {
      duration = overrideTimer;
    } else {
      // Lógica padrão sem override
      const isBranding = activeSlide === totalSlides - 1;
      const avisoIndex = activeSlide - countFactory - countMaquinas;
      const isAviso = avisoIndex >= 0 && avisoIndex < countAvisos;

      if (isBranding) duration = 3000;
      if (isAviso) duration = 10000;
    }

    const id = window.setTimeout(() => {
      // Ao virar o slide, limpamos o override (a menos que seja apresentação, mas aí o useEffect 3 trata)
      if (overrideTimer) setOverrideTimer(null);
      setActiveSlide((prev) => (prev + 1) % totalSlides);
    }, duration);

    return () => window.clearTimeout(id);
  }, [totalSlides, activeSlide, countFactory, countMaquinas, countAvisos, overrideTimer]);

  useEffect(() => { setActiveSlide(0); }, [scope, centroPages.length]);

  const goPrev = useCallback(() => setActiveSlide((prev) => (prev - 1 + totalSlides) % totalSlides), [totalSlides]);
  const goNext = useCallback(() => setActiveSlide((prev) => (prev + 1) % totalSlides), [totalSlides]);

  // Função para sair manualmente da apresentação
  const handleExitPresentation = useCallback(() => {
    setIsPresentationMode(false);
    setOverrideTimer(null);
    goNext();
  }, [goNext]);

  // Efeito para entrar/sair do Fullscreen real
  useEffect(() => {
    if (isPresentationMode && rootRef.current && !document.fullscreenElement) {
      rootRef.current.requestFullscreen().catch(err => console.log("Fullscreen negado:", err));
    }
  }, [isPresentationMode]);

  // --- RENDERIZAÇÃO DO CONTEÚDO ---
  let slideContent = null;
  let slideTitle = "";

  if (activeSlide === 0) {
    if (isPresentationMode) setIsPresentationMode(false);
    slideTitle = "Visão Geral";
    slideContent = <SlideFactory dias={factoryDays} />;
  } else if (activeSlide > 0 && activeSlide <= countMaquinas) {
    if (isPresentationMode) setIsPresentationMode(false);
    const pageIndex = activeSlide - 1;
    slideTitle = `Máquinas - Pág ${pageIndex + 1} de ${countMaquinas}`;
    slideContent = <SlideMaquinas page={centroPages[pageIndex] ?? []} isFuture={contextDia.isFuture} />;
  } else if (activeSlide > countMaquinas && activeSlide <= countMaquinas + countAvisos) {
    const avisoIndex = activeSlide - 1 - countMaquinas;
    const avisoAtual = slideAvisos[avisoIndex];

    if (avisoAtual.exibir_como === 'apresentacao' && avisoAtual.arquivo_url) {
      // ATIVA MODO APRESENTAÇÃO
      if (!isPresentationMode) setIsPresentationMode(true);
      slideTitle = `Apresentação • Pág ${avisoAtual.pagina_atual || 1}`;
      slideContent = <SlideApresentacao url={avisoAtual.arquivo_url} pagina={avisoAtual.pagina_atual || 1} />;
    } else {
      if (isPresentationMode) setIsPresentationMode(false);
      slideTitle = "Comunicado Importante";
      slideContent = <SlideAviso aviso={avisoAtual} />;
    }
  } else {
    if (isPresentationMode) setIsPresentationMode(false);
    slideTitle = "";
    slideContent = <SlideBranding />;
  }

  const hasTicker = tickerAvisos.length > 0;

  // Estilos Condicionais
  const mainContainerStyle: React.CSSProperties = isPresentationMode
    ? { flex: 1, padding: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }
    : { flex: 1, padding: '16px 24px', display: 'flex', flexDirection: 'column', minHeight: 0 };

  const cardStyle: React.CSSProperties = isPresentationMode
    ? { flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, borderRadius: 0, border: 'none' }
    : { flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 };

  const headerStyle: React.CSSProperties = isPresentationMode
    ? { position: 'absolute', top: 10, left: 10, zIndex: 1000, background: 'rgba(0,0,0,0.5)', padding: '4px 8px', borderRadius: 4, color: 'white' }
    : {};

  return (
    <div ref={rootRef} style={{ width: '100vw', height: '100vh', background: '#f5f5f7', display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative' }}>

      {/* CABEÇALHO PRINCIPAL (Oculto na apresentação) */}
      {!isPresentationMode && (
        <div style={{ padding: '16px 24px 0' }}>
          <Group justify="space-between" align="center" mb="sm">
            <Group gap="sm" align="center">
              <Button variant="subtle" color="gray" size="md" leftSection={<IconArrowLeft size={20} />} onClick={() => navigate('/tv')} styles={{ root: { paddingLeft: 0, paddingRight: 10 } }}>Menu</Button>
              <ThemeIcon size="lg" radius="md" color="blue" variant="light"><IconTrendingUp size={20} /></ThemeIcon>
              <Title order={2}>{tituloPainel}</Title>
            </Group>
            <Group gap="lg" align="center">
              <Card padding="xs" radius="md" withBorder shadow="xs" bg="white">
                <Group gap="xs"><Text size="xs" fw={700} c="dimmed">MÊS</Text><Badge variant="light" color="gray" size="lg">Meta: {formatNum(resumo.metaMes)}h</Badge><Badge variant="filled" color="blue" size="lg">Real: {formatNum(resumo.realMes)}h</Badge><Badge variant="filled" color={perfColor(resumo.metaMes > 0 ? (resumo.realMes / resumo.metaMes) * 100 : 0)} size="lg">{resumo.metaMes > 0 ? `${formatNum((resumo.realMes / resumo.metaMes) * 100, 1)}%` : '-'}</Badge></Group>
              </Card>
              <Card padding="xs" radius="md" withBorder shadow="xs" bg="white">
                <Group gap="xs"><Text size="xs" fw={700} c="dimmed">DIA</Text><Badge variant="light" color="gray" size="lg">Meta: {formatNum(resumo.metaDia)}h</Badge><Badge variant="outline" color="blue" size="lg">Real: {formatNum(resumo.realDia)}h</Badge><Badge variant="outline" color={perfColor(resumo.esperadoDia > 0 ? (resumo.realDia / resumo.esperadoDia) * 100 : 0)} size="lg">{resumo.esperadoDia > 0 ? `${formatNum((resumo.realDia / resumo.esperadoDia) * 100, 1)}%` : '-'}</Badge></Group>
              </Card>

              {/* --- CARD ATUALIZADO (Data de Referência em Destaque) --- */}
              <Card padding="sm" radius="md" withBorder shadow="sm" bg="white">
                <Group gap="sm">
                  <ThemeIcon
                    size="lg"
                    radius="xl"
                    // Se for hoje usa cor normal (teal), se for ontem/passado usa Laranja p/ alertar
                    color={contextDia.isToday ? "teal" : "orange"}
                    variant="light"
                  >
                    {contextDia.isToday ? <IconClock size={20} /> : <IconCalendar size={20} />}
                  </ThemeIcon>
                  <Stack gap={0}>
                    <Text size="xs" c="dimmed" fw={700} tt="uppercase">Visão de</Text>
                    <Text size="lg" fw={900} c="dark" style={{ lineHeight: 1.1 }}>{dataReferenciaText}</Text>
                  </Stack>
                </Group>
              </Card>

              {/* --- NOVO CARD: Último Upload --- */}
              <Card padding="sm" radius="md" withBorder shadow="sm" bg="white">
                <Group gap="sm">
                  <ThemeIcon
                    size="lg"
                    radius="xl"
                    color="blue"
                    variant="light"
                  >
                    <IconCloudUpload size={20} />
                  </ThemeIcon>
                  <Stack gap={0}>
                    <Text size="xs" c="dimmed" fw={700} tt="uppercase">Última Atualização</Text>
                    <Text size="md" fw={900} c="dark" style={{ lineHeight: 1.1 }}>{lastUpdateText}</Text>
                  </Stack>
                </Group>
              </Card>

              <ActionIcon variant="subtle" color="gray" onClick={toggleFullscreen}>{isFullscreen ? <IconMinimize size={20} /> : <IconMaximize size={20} />}</ActionIcon>
            </Group>
          </Group>
        </div>
      )}

      <div style={mainContainerStyle}>
        <Stack h="100%" gap={isPresentationMode ? 0 : "sm"}>

          {/* CARD DO SLIDE */}
          <Card withBorder={!isPresentationMode} shadow={isPresentationMode ? undefined : "sm"} radius={isPresentationMode ? 0 : "lg"} padding={isPresentationMode ? 0 : "lg"} style={cardStyle}>
            {loading ? <Group justify="center" align="center" style={{ height: '100%' }}><Loader size="xl" /></Group> : (
              <>
                {/* Navegação do Slide */}
                <Group justify="space-between" mb={isPresentationMode ? 0 : "xs"} align="center" style={headerStyle}>
                  <Group gap="xs" align="center">
                    {!isPresentationMode && <ActionIcon variant="light" radius="xl" onClick={goPrev} size="lg"><IconChevronLeft size={18} /></ActionIcon>}
                    {!isPresentationMode && totalSlides <= 15 && (
                      <Group gap={6}>{Array.from({ length: totalSlides }).map((_, idx) => (<ActionIcon key={idx} radius="xl" size="sm" variant={idx === activeSlide ? 'filled' : 'light'} color={idx === activeSlide ? 'blue' : 'gray'} onClick={() => setActiveSlide(idx)} />))}</Group>
                    )}
                    <Text fw={600} c={isPresentationMode ? "white" : "dimmed"} size="sm" style={{ textShadow: isPresentationMode ? '0 1px 2px rgba(0,0,0,0.8)' : 'none' }}>
                      {slideTitle}
                    </Text>
                    {!isPresentationMode && <ActionIcon variant="light" radius="xl" onClick={goNext} size="lg"><IconChevronRight size={18} /></ActionIcon>}
                  </Group>
                </Group>

                {/* Conteúdo */}
                <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
                  {slideContent}

                  {/* Botão Sair Emergência */}
                  {isPresentationMode && (
                    <ActionIcon
                      variant="filled" color="dark" size="lg" radius="xl"
                      style={{ position: 'absolute', top: 10, right: 10, zIndex: 1001, opacity: 0.6 }}
                      onClick={handleExitPresentation}
                      onMouseEnter={(e) => e.currentTarget.style.opacity = '1'}
                      onMouseLeave={(e) => e.currentTarget.style.opacity = '0.6'}
                    >
                      <IconX size={20} />
                    </ActionIcon>
                  )}
                </div>
              </>
            )}
          </Card>
        </Stack>
      </div>

      {/* Ticker (Oculto na apresentação) */}
      {!isPresentationMode && hasTicker && !loading && <TickerBar avisos={tickerAvisos} />}
    </div>
  );
}