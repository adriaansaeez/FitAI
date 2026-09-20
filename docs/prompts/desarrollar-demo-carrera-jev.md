# Prompt de desarrollo: demo de carrera simulada con Jev

Copia este prompt para iniciar el desarrollo de la demo.

---

## Objetivo

Construye una demo web local que simule una carrera de 10 minutos, segundo a segundo, y permita observar cómo Jev interpreta el estado de entrenamiento para decidir entre:

- subir suave;
- mantener;
- bajar suave;
- recuperar;
- datos insuficientes;
- detener y escalar.

La demo no se conecta a relojes reales ni a Strava en esta fase. Debe usar un recorrido y unas métricas ficticias, reproducibles y transparentes. Su propósito es validar el flujo de datos, las gráficas, las guardas de seguridad y el comportamiento de Jev antes de integrar dispositivos reales.

## Contexto funcional

La aplicación representa un corredor que realiza una carrera planificada. Cada segundo se genera una muestra de actividad con ritmo, FC, distancia, elevación/pendiente, calidad de señal y, en puntos concretos, RPE o síntomas.

La simulación debe incluir:

1. Un recorrido ficticio con cambios de pendiente.
2. Al menos cuatro escenarios de carrera predefinidos.
3. Un historial del mismo atleta de cero a diez sesiones previas.
4. Decisiones y trazas visibles para cada segundo de la sesión actual.
5. Dos modos de decisión:
   - Mock determinista para desarrollo y tests.
   - Jev real, activable por configuración de servidor.

No implementar diagnóstico, consejo médico ni integración con datos reales.

## Decisión técnica

Usar TypeScript de extremo a extremo. Mantener todo el acceso a TypeSafe/Jev en el servidor: la clave API no puede estar en el navegador.

Si el repositorio ya define framework, respetarlo. Si está vacío, crear una app sencilla con:

- Next.js + TypeScript;
- React para interfaz;
- una librería de gráficas ligera, por ejemplo Recharts;
- validación de datos con Zod;
- SDK JavaScript de TypeSafe para Jev;
- Vitest para lógica de dominio.

No añadir autenticación, base de datos ni diseño complejo. Persistir escenarios e historial como archivos JSON/TypeScript locales.

## Arquitectura

~~~text
scenarios + athlete history
        ↓
simulation engine: 1 muestra por segundo
        ↓
metric engine: ventanas y métricas derivadas
        ↓
safety policy: reglas deterministas
        ↓
decision adapter: mock o Jev
        ↓
decision composer: guardas + probabilidades + límites
        ↓
timeline, gráficas, explicación y auditoría
~~~

Separar estas piezas claramente:

- src/domain: tipos, cálculos, reglas y compositor sin UI.
- src/simulation: generador de ruta, escenarios y muestras.
- src/services: adaptador MockDecisionProvider y JevDecisionProvider.
- src/components: gráficas, selector, controles y tabla de decisiones.
- src/app o páginas: composición de la pantalla.
- tests: escenarios y decisiones de dominio.

## Modelo de datos

Implementar tipos equivalentes a estos. Se pueden ampliar, pero no eliminar campos de seguridad.

~~~ts
type TrainingBlock = "warmup" | "easy" | "tempo" | "interval" | "recovery";

type RunningSample = {
  second: number;
  timestamp: string;
  paceSecPerKm: number | null;
  heartRateBpm: number | null;
  distanceM: number;
  elevationM: number;
  gradePct: number;
  cadenceSpm: number | null;
  signalQuality: "high" | "medium" | "low";
  dataAgeSeconds: number;
  autoPaused: boolean;
  rpe?: number;
  symptomsReported: boolean;
};

type AthleteSessionSummary = {
  id: string;
  date: string;
  workoutType: TrainingBlock;
  durationSeconds: number;
  distanceM: number;
  averagePaceSecPerKm: number;
  averageHeartRateBpm?: number;
  rpe?: number;
  completedAsPlanned: boolean;
  notes?: string;
};

type AthleteProfile = {
  id: string;
  displayName: string;
  sessions: AthleteSessionSummary[];
  baseline: {
    typicalEasyPaceSecPerKm?: number;
    typicalEasyHrBpm?: number;
    typicalEasyRpe?: number;
  };
};

type DerivedMetrics = {
  paceWindowSecPerKm: number | null;
  heartRateWindowBpm: number | null;
  hrTrendBpmPerMin: number | null;
  paceVsTargetSeconds: number | null;
  comparableHistoryCount: number;
  historicalPaceDeltaSeconds: number | null;
  historicalHrDeltaBpm: number | null;
  historyMaturity: "none" | "early" | "established";
};

type SafetyResult = {
  hardStop: boolean;
  mayIncreaseIntensity: boolean;
  missingRequiredMetric: boolean;
  reasonCodes: string[];
};

type DecisionAction =
  | "increase_gently"
  | "maintain"
  | "decrease_gently"
  | "recover"
  | "insufficient_data"
  | "stop_and_escalate";

type DecisionTrace = {
  second: number;
  action: DecisionAction;
  source: "safety" | "mock" | "jev" | "composer";
  confidence?: number;
  probabilities?: Record<string, number>;
  reasonCodes: string[];
  explanationKey: string;
  derivedMetrics: DerivedMetrics;
  safety: SafetyResult;
};
~~~

## Simulación y escenarios

Generar una ruta de 600 segundos con distancia, elevación y pendiente coherentes. Usar una semilla fija para que el mismo escenario produzca exactamente los mismos resultados.

Implementar estos cinco escenarios:

| Id | Descripción | Resultado esperado |
|---|---|---|
| easy-under-target | Carrera fácil estable, corredor por debajo de ritmo objetivo, FC/RPE bajos | Tras suficiente evidencia, una subida suave limitada |
| cardiac-drift | Igual ritmo pero FC sube de forma sostenida y RPE alcanza 7 | Bajar suave o recuperar; nunca subir |
| uphill | Ritmo disminuye durante una subida, FC aumenta de manera explicable | Mantener o bajar suave; no interpretar ritmo lento como falta de esfuerzo |
| poor-signal | FC con huecos/picos, GPS/ritmo de baja calidad o antiguo | Datos insuficientes o mantener; nunca subir |
| symptom-stop | Síntoma reportado durante la sesión | Detener y escalar sin llamar a Jev |

## Historial del atleta

Permitir seleccionar 0, 1, 3, 5 o 10 sesiones previas del mismo corredor. El historial representa sesiones comparable de tipo easy y, opcionalmente, otras no comparables.

La referencia personal usa solo sesiones comparables:

- mismo tipo de entrenamiento;
- duración aproximada compatible;
- sin síntomas;
- completadas según el plan.

| Madurez | Sesiones | Uso |
|---|---:|---|
| none | 0 | Usar solo plan actual + seguridad; reducir confianza y no subir con facilidad |
| early | 1–3 | Mostrar referencia provisional y comparar con cautela |
| established | 4–10 | Comparar contra mediana o media recortada de ritmo, FC y RPE |

La interfaz debe dejar claro que el historial cambia confianza y explicación, no infiere una condición de salud.

## Cálculos

Implementar de forma determinista:

- ritmo suavizado con ventana 30–60 s;
- FC suavizada con ventana 60–90 s;
- tendencia de FC en bpm/min;
- distancia acumulada integrando ritmo;
- diferencia con rango de ritmo del bloque;
- pendiente a partir de elevación;
- calidad y frescura de datos;
- referencia histórica como mediana de sesiones comparables;
- diferencia actual contra referencia histórica de ritmo y FC.

No usar calorías, pasos, VO2max, SpO2 ni índices de recovery como disparador V1.

## Política de seguridad

Implementar antes del proveedor Jev:

1. Si symptomsReported es true, devolver stop_and_escalate inmediatamente.
2. Si señal es low, datos tienen más de 15 s o hay autopausa, devolver insufficient_data o maintain; nunca increase_gently.
3. Si faltan ritmo y FC, devolver insufficient_data.
4. En warmup o recovery, mayIncreaseIntensity es false.
5. Aplicar cooldown de 60 s tras un cambio de ritmo.
6. Seguridad tiene prioridad sobre MockDecisionProvider y JevDecisionProvider.

## Uso de Jev

No usar Jev para calcular números, aplicar umbrales, determinar síntomas críticos ni redactar texto libre. Jev clasifica contexto ya procesado.

Crear esta interfaz:

~~~ts
interface DecisionProvider {
  decide(input: {
    context: Record<string, unknown>;
    previousDecision?: DecisionTrace;
  }): Promise<{
    action: Exclude<DecisionAction, "stop_and_escalate">;
    actionConfidence?: number;
    disproportionateEffortProbability?: number;
    contextExplanation:
      | "uphill_or_terrain"
      | "pace_below_target"
      | "likely_heat_or_fatigue"
      | "normal_variation"
      | "not_enough_context";
    interpretability?: {
      score: number;
      confidence: number;
      probabilities: Record<number, number>;
    };
    raw?: unknown;
  }>;
}
~~~

MockDecisionProvider debe ser determinista. JevDecisionProvider hace una llamada System One por evaluación, con estado JSON reducido y cuatro preguntas independientes:

1. Choice effort_action:
   - increase_gently
   - maintain
   - decrease_gently
   - recover
   - insufficient_evidence

2. Noul effort_disproportionate:
   - pregunta si el esfuerzo aparente es desproporcionado para el objetivo actual.

3. Choice context_explanation:
   - uphill_or_terrain
   - pace_below_target
   - likely_heat_or_fatigue
   - normal_variation
   - not_enough_context

4. Score context_interpretability:
   - unusable;
   - limited;
   - clear.

Las instrucciones y criterios se escriben en inglés sencillo y específico. Usar el SDK actual de TypeSafe. No exponer TYPESAFE_API_KEY al cliente. Sin clave, seleccionar MockDecisionProvider y mostrar “Modo simulación”.

La UI guarda una traza por segundo. Hacer llamadas reales a Jev con intervalo configurable 1, 5 o 15 s. El valor predeterminado de demo será 1 s para observar el comportamiento, con aviso visible de que no es cadencia de producción. En segundos sin llamada, reutilizar la última decisión y marcarla como reutilizada. El modo mock puede evaluar cada segundo.

## Compositor

Crear una función pura:

~~~ts
function composeDecision(
  sample: RunningSample,
  metrics: DerivedMetrics,
  safety: SafetyResult,
  providerResult: ProviderResult | null,
  previousDecision: DecisionTrace | null,
): DecisionTrace
~~~

Política inicial:

- hardStop produce stop_and_escalate.
- métricas requeridas ausentes o señal mala producen insufficient_data.
- confidence de Choice menor de 0.70 produce maintain.
- Score de interpretabilidad menor de 1.4 o confidence menor de 0.75 produce maintain.
- increase_gently solo es válido en easy, mayIncreaseIntensity true y probabilidad de esfuerzo desproporcionado menor de 0.30.
- Una subida limita ajuste a 5–10 s/km durante 60 s.
- decrease_gently limita cambio a 5–15 s/km.
- recover reevalúa a los 90 s.
- Guardas se registran como source safety, aunque Jev no haya sido llamado.

Los valores son de piloto, no umbrales fisiológicos. Los mensajes al corredor serán plantillas en español, no texto libre de Jev.

## Interfaz

Crear una pantalla única, sobria y accesible.

### Controles superiores

- Selector de escenario.
- Selector de sesiones históricas: 0, 1, 3, 5, 10.
- Selector de proveedor: Mock o Jev.
- Selector de intervalo Jev: 1, 5, 15 s.
- Reiniciar, reproducir/pausar, avanzar un segundo y velocidad 1x/5x/20x.
- Indicador de segundo actual y modo activo.

### Resumen

Tarjetas de acción actual/color semáforo, confianza/origen, ritmo/objetivo, FC/tendencia, RPE/pendiente, calidad/frescura y madurez/línea base histórica.

### Gráficas sincronizadas

Usar cursor vertical común en el segundo seleccionado:

1. Ritmo frente a rango objetivo.
2. FC frente a referencia histórica si existe.
3. Elevación y pendiente.
4. RPE si está disponible.
5. Línea o bandas de decisiones por acción.
6. Comparación con mediana histórica por segmento, solo en estado established.

### Historial de decisiones

Tabla virtualizada o paginada con una fila por segundo:

| Segundo | Acción | Origen | Confianza | Ritmo | FC | Pendiente | Historial | Razón |
|---|---|---|---|---|---|---|---|---|

Al seleccionar una fila, sincronizar gráficas y abrir auditoría: métricas derivadas, guardas, preguntas Jev, probabilidades, regla final y marca de decisión reutilizada.

## Errores y estados

- Sin API key: mock por defecto, sin error.
- Error o timeout Jev: mantener, registrar fallo y seguir simulación.
- Sin FC: datos insuficientes explícitos.
- Historial 0: “sin referencia personal; confianza limitada”.
- Completar simulación sin red usando mock.

## Tests obligatorios

1. Misma semilla produce la misma carrera.
2. Síntoma nunca llama proveedor y produce stop_and_escalate.
3. Señal low nunca produce increase_gently.
4. Easy-under-target con historial established puede producir subida limitada.
5. Cardiac-drift nunca produce increase_gently.
6. Uphill no interpreta ritmo lento como necesidad de subir.
7. Historial 0 produce none y confianza reducida.
8. Historial 10 calcula baseline desde sesiones comparables.
9. Cooldown evita cambios opuestos inmediatos.
10. Fallo del proveedor no intensifica.

## Criterios de aceptación

- Arranque con un comando documentado.
- Reproducción, pausa, reinicio y avance segundo a segundo.
- Gráficas y tabla sincronizadas.
- Diferencia visible entre cero y diez sesiones de historial.
- Cada decisión tiene causa, origen y traza.
- Guardas dominan siempre.
- Mock funciona sin clave; Jev solo desde servidor.
- Tests obligatorios pasan.
- README con instalación, variables de entorno, controles y límites médicos.

## Restricciones

- No conectar todavía WHOOP, Amazfit, Xiaomi ni Strava.
- No usar datos reales.
- No afirmar diagnóstico, prevención de lesión ni consejo médico.
- No sobreescribir documentos existentes.
- Priorizar claridad de decisiones sobre diseño visual complejo.

## Entregable

Entregar demo funcional, escenarios reproducibles, adaptadores mock/Jev, gráficas, tabla por segundo, tests y README. Al terminar, resumir archivos creados, ejecución, activación Jev y escenarios recomendados.

