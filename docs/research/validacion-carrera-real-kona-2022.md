# Validación con datos reales: Gustav Iden, Kona 2022

Este documento define el primer caso reproducible para ejecutar la demo con datos
reales y comparar las decisiones de Jev con lo que ocurrió después. El caso es
**el tramo de carrera a pie de Gustav Iden en el IRONMAN World Championship de
Kona del 8 de octubre de 2022**. La implementación no debe cargar la carrera
entera: debe extraer de forma determinista una ventana aleatoria de **10 a 30
minutos**, más un preroll técnico de 90 s que no se muestra ni entra en las
métricas de resultado.

> Resultado esperado: un agente puede descargar, verificar, normalizar,
> seleccionar y reproducir una ventana real sin inventar señales ausentes ni
> alterar los escenarios sintéticos existentes.

## Camino rápido

1. Descargar el CSV público de Gustav Iden desde el repositorio de Entalpi y
   verificar su huella y cabeceras.
2. Convertir sus muestras de 1 Hz a `RunningSample` y seleccionar una ventana
   de 600--1.800 s con una semilla explícita.
3. Ejecutar la tubería actual sobre la ventana, usando `historyCount: 0` y sin
   RPE ni síntomas inventados.
4. Evaluar a Jev cada 60 s y en cambios de bloque/eventos; comparar cada
   decisión con los 60--90 s observados posteriores y con el vídeo.

## Decisiones de diseño

| Tema | Decisión |
|---|---|
| Carrera | Carrera a pie de Gustav Iden, Kona 2022; no natación ni ciclismo. |
| Fuente de telemetría | CSV de reloj, publicado por Entalpi. |
| Duración visible | Aleatoria y determinista: mínimo 600 s, máximo 1.800 s. |
| Contexto técnico | 90 s previos ocultos para que ritmo, FC y tendencia tengan ventana completa desde la primera decisión visible. |
| Semilla | Obligatoria y almacenada en auditoría; misma semilla y dataset producen la misma ventana. |
| Historial/RPE/síntomas | No disponibles públicamente: historial `0`; RPE ausente; `symptomsReported: false` sólo significa «no consta en el dataset», no «se descartaron síntomas». |
| Tipo de bloque | `tempo` o, preferiblemente, un nuevo modo de validación de carrera que nunca habilite `increase_gently` sin un objetivo y plan publicados. |
| Objetivo de ritmo | No hay un objetivo público verificable. No usar el ritmo observado para construir un objetivo retrospectivo. |
| Cadencia | Conservar el valor publicado y su unidad como metadato; no multiplicarlo por dos sin confirmar la semántica del dispositivo. No es un disparador V1. |
| Licencia | CC BY-NC 4.0: atribuir a Entalpi y no incluir ni servir el raw dataset en un uso comercial sin autorización. |

## Fuentes canónicas

| Recurso | Uso | URL |
|---|---|---|
| Dataset Entalpi | Telemetría primaria y licencia | <https://github.com/entalpi-no/kona-2022> |
| CSV de Gustav | Entrada de la normalización | <https://raw.githubusercontent.com/entalpi-no/kona-2022/main/gustav_iden_copyright_entalpi_as.csv> |
| Resultado desglosado | Control externo de distancia, tiempo y parciales | <https://www.endurance-data.com/en/result/761/8-gustav-iden/> |
| Repetición de la carrera | Revisión visual de incidentes, adelantamientos y avituallamientos | <https://www.tri247.com/triathlon-news/elite/live-ironman-kona-world-championship-2022-men> |
| Vídeo del maratón | Revisión rápida centrada en la carrera a pie | <https://www.youtube.com/watch?v=bDNJGTmMe0Y> |

El README del dataset declara explícitamente estas columnas: `datetime`,
`latitude`, `longitude`, `speed`, `elevation`, `heartrate`, `cadence` y
`stride_length`. Para Iden hay 9.342 filas de un segundo, desde
`2022-10-08 21:30:07+00:00` hasta `2022-10-09 00:05:48+00:00`. La integración
de `speed` da 42,205 km; como control externo, el resultado oficial registra
42,6 km y 2:36:15 de carrera.

## Adquisición y licencia

No se debe hacer `fetch` del CSV desde el navegador en cada reproducción ni
depender de CORS. Elegir una de estas dos rutas antes de implementar:

1. **Desarrollo/no comercial:** un script versionado descarga el raw CSV a un
   directorio ignorado, verifica cabecera y genera un fixture derivado local.
   Mostrar atribución y la licencia en la UI/documentación.
2. **Producto distribuido o comercial:** no copiar el CSV al repositorio ni a
   `public/`. Obtener autorización/licencia de Entalpi o sustituirlo por un
   dataset compatible.

El script de descarga debe recibir URL y destino como argumentos, no almacenar
credenciales, y debe fallar si la cabecera no coincide. Guardar al menos:

```text
sourceUrl
downloadedAt
sha256
license = "CC BY-NC 4.0"
athlete = "Gustav Iden"
event = "IRONMAN World Championship Kona 2022"
```

## Contrato de entrada y normalización

### CSV fuente

```text
datetime,latitude,longitude,speed,elevation,heartrate,cadence,stride_length
2022-10-08 21:30:07+00:00,19.641769845038652,-155.99632889963686,3.49,-9.2,159,85.0,
```

`speed` está en m/s, `elevation` en metros y `heartrate` en bpm. La fuente
declara `cadence` como `/min`, pero no confirma si cuenta pasos o zancadas;
guardar el valor publicado y documentar la ambigüedad. Nunca convertir campos
ausentes a cero.

### Mapeo a `RunningSample`

| `RunningSample` | Regla |
|---|---|
| `second` | Índice local 1-based de la ventana visible. El preroll tiene índices internos negativos/0, no se expone. |
| `timestamp` | Parsear `datetime` a ISO 8601 UTC sin cambiar el instante. |
| `paceSecPerKm` | `1000 / speed` cuando `speed > 0`; `null` si falta o no es positiva. No redondear hasta presentar. |
| `heartRateBpm` | Número de `heartrate`; `null` si falta o no es finito. |
| `distanceM` | Suma local de `speed × deltaSeconds`; empieza en 0 al inicio visible. No usar el GPS para integrar distancia si la fuente ya da velocidad a 1 Hz. |
| `elevationM` | Elevación publicada, preservando referencia absoluta. |
| `gradePct` | `(elevación_actual - elevación_anterior) / distancia_del_segundo × 100`; para el primer punto visible, calcularlo con el último punto de preroll. Si no hay distancia, `0`. |
| `cadenceSpm` | Cadencia publicada o `null`; conservar `cadenceSemantics: "source_per_min_unknown"` en metadatos de la ventana. |
| `signalQuality` | `high` sólo cuando las marcas temporales consecutivas son de 1 s y los campos de ritmo/FC requeridos están presentes; en otro caso `medium`/`low` según la política de calidad definida abajo. |
| `dataAgeSeconds` | Diferencia en segundos respecto de la muestra anterior válida. Para una serie continua es `0`. |
| `autoPaused` | `false`: la fuente no publica estado de autopausa. Una velocidad baja no autoriza inferir una pausa. |
| `rpe` | Omitir; no existe en la fuente. |
| `symptomsReported` | `false`, junto a `symptomsSource: "not_reported_by_dataset"` en metadatos. No presentarlo como ausencia clínica de síntomas. |

Conservar también un tipo de procedencia fuera de `RunningSample` para evitar
atribuir falsamente campos derivados al atleta:

```ts
type RealRaceWindow = {
  id: "kona-2022-gustav-iden";
  source: {
    url: string;
    license: "CC BY-NC-4.0";
    sha256: string;
    athlete: "Gustav Iden";
    event: "IRONMAN World Championship Kona 2022";
  };
  seed: number;
  startSourceIndex: number;
  visibleDurationSeconds: number;
  prerollSeconds: 90;
  samples: RunningSample[];
  unavailable: {
    rpe: true;
    symptoms: "not_reported_by_dataset";
    personalHistory: true;
    plannedTarget: true;
  };
};
```

## Selección aleatoria, reproducible y útil

La aleatoriedad existe para exponer al modelo a tramos diferentes; jamás debe
impedir repetir un resultado.

```ts
const MIN_VISIBLE_SECONDS = 10 * 60;
const MAX_VISIBLE_SECONDS = 30 * 60;
const PREROLL_SECONDS = 90; // >= HR_WINDOW_SECONDS (75)

function selectWindow(rows: RawRow[], seed: number): SelectedRows {
  const rng = createRng(seed);
  const maxDuration = Math.min(MAX_VISIBLE_SECONDS, rows.length - PREROLL_SECONDS);
  const duration = rngInt(rng, MIN_VISIBLE_SECONDS, maxDuration);
  const maxStart = rows.length - PREROLL_SECONDS - duration;
  const start = rngInt(rng, 0, maxStart);
  return {
    preroll: rows.slice(start, start + PREROLL_SECONDS),
    visible: rows.slice(start + PREROLL_SECONDS, start + PREROLL_SECONDS + duration),
    startSourceIndex: start + PREROLL_SECONDS,
  };
}
```

Requisitos de la función:

- Validar antes que hay al menos `PREROLL_SECONDS + MIN_VISIBLE_SECONDS` filas.
- Usar el RNG existente (`src/simulation/rng.ts`), nunca `Math.random()`.
- La duración debe ser inclusiva dentro de 600--1.800 s. Si se desea fijarla,
  aceptar `durationSeconds` como override validado.
- Semilla, índices de inicio/fin, timestamps y duración se guardan en el
  registro de auditoría y se muestran en la UI.
- No descartar ventanas con avituallamientos o ritmos bajos: son eventos reales
  y la política de datos debe manejarlos. Sólo rechazar series corruptas o con
  discontinuidades documentadas.

El preroll se usa exclusivamente para los cálculos de 45 s de ritmo y 75 s de
FC/tendencia. La primera muestra visible se presenta como segundo 1; los 90 s
anteriores no se muestran, no generan decisión y no forman parte de las
métricas de concordancia.

## Calidad de datos

Aplicar estas reglas de normalización, antes de que corra la política de
seguridad existente:

| Condición | `signalQuality` / `dataAgeSeconds` |
|---|---|
| Delta temporal = 1 s y ritmo + FC disponibles | `high`, `0` |
| Delta temporal 2--15 s o falta uno de ritmo/FC | `medium`, delta observado |
| Delta temporal >15 s, timestamp no monótono o faltan ritmo y FC | `low`, delta observado; la política existente debe devolver `insufficient_data` |
| Velocidad `<= 0`, no finita o FC no finita | El campo afectado es `null`; no interpolar |

No suavizar, rellenar, eliminar picos ni corregir GPS en el adaptador. Las
ventanas de métricas existentes ya suavizan ritmo y FC; conservar el raw hace
auditable cualquier decisión.

## Cambios concretos que necesita el código

1. Crear un módulo de solo servidor/build, por ejemplo
   `src/simulation/realRace/kona2022.ts`, que haga parseo, validación,
   normalización y selección. No importarlo directamente desde un componente
   cliente si contiene el raw CSV.
2. Crear una abstracción de fuente de simulación: los escenarios sintéticos
   continúan usando `generateScenarioSamples`, mientras que el modo real
   entrega `{ samples, totalSeconds, metadata }`.
3. Sustituir los usos rígidos de `SIMULATION_SECONDS = 600` por
   `samples.length`/`totalSeconds`: ticker, `completed`, avance manual,
   selección, límites de gráficos y texto de estado.
4. En `SynchronizedCharts`, reemplazar dominios fijos `[1, 600]`, rangos de
   ritmo fijos y bandas 315--330 por los valores del descriptor de la sesión.
5. No usar `generateAthleteHistory` para esta carrera. Pasar un perfil con
   cero sesiones y baseline vacío; mostrar «historial no publicado».
6. Extender los metadatos/auditoría de una entrada real con fuente, licencia,
   hash, semilla, intervalo fuente y segundos de preroll. No enviar esos datos
   identificativos ni el track GPS completo a Jev.
7. Hacer que el objetivo de ritmo sea opcional para el modo real. Mientras no
   exista plan público, Jev recibe estado sin `target`; el compositor debe
   impedir `increase_gently` cuando no hay objetivo/historial suficiente.
8. Crear un selector «Carrera real: Kona 2022 / Gustav Iden», un control de
   semilla y, opcionalmente, uno de duración. Etiquetar claramente el modo como
   «telemetría real; RPE, síntomas y plan no publicados».

No cambiar los contratos de los cinco escenarios existentes ni sus expectativas
de tests. El modo real es un origen adicional, no el sexto escenario sintético.

## Ejecución de Jev

El intervalo de 1/5/15 s actual es sólo de demostración y generaría demasiadas
llamadas en ventanas largas. Para este modo:

- Evaluar en el primer segundo visible tras completar el preroll y después
  cada **60 s** estables.
- Forzar evaluación si cambia el bloque, aparece una discontinuidad de datos o
  se introduce un RPE/síntoma manual en una futura extensión.
- Entre evaluaciones, reutilizar la última decisión y marcarla como reutilizada.
- Si no hay `TYPESAFE_API_KEY`, ejecutar Mock para comprobar el cableado, pero
  nunca presentar ese resultado como una predicción de Jev.
- Mantener en servidor la clave y las llamadas a Jev, como ya hace
  `POST /api/decide`.

Para evitar una inferencia retrospectiva engañosa, el modo debe fallar cerrado:
sin objetivo pre-race verificable, sin historia comparable o sin RPE, la salida
permitida es `maintain`, `decrease_gently`, `recover` o `insufficient_data`;
no `increase_gently`.

## Qué se compara y qué no

No existe en el dataset la «decisión real» de Iden en cada segundo. Por tanto,
esto es una validación de coherencia y prudencia, no una medición de precisión
clínica ni la afirmación de que Jev conoce la intención del atleta.

Para cada decisión emitida en el segundo `t`, guardar una fila de evaluación:

| Campo | Definición |
|---|---|
| `decisionSecond` | Segundo local visible de la decisión. |
| `action`, `reasonCodes`, `confidence` | Salida final de la tubería. |
| `contextSnapshot` | Sólo métricas derivadas y calidad; sin GPS completo ni identificadores. |
| `observedNext60s` / `observedNext90s` | Cambio de ritmo medio, FC media y tendencia desde el raw normalizado. |
| `terrainDelta` | Cambio de elevación y pendiente media posteriores. |
| `videoReview` | Enlace/timestamp y etiqueta humana opcional: avituallamiento, adelantamiento, subida, descenso, sin evidencia. |
| `assessment` | `consistent`, `conservative`, `unsupported` o `not_assessable`; la etiqueta la asigna un revisor humano. |

No usar una aceleración posterior como prueba automática de que `increase_gently`
era correcto: el atleta podía estar siguiendo un plan, respondiendo a rivales o
entrando en una bajada. El vídeo y los parciales sirven para investigar, no para
inventar etiquetas.

## Casos de prueba mínimos

- [ ] El parser rechaza una cabecera distinta, timestamps no válidos y menos de
  690 filas.
- [ ] Dos extracciones con mismo dataset, semilla y override producen muestras
  y metadatos idénticos.
- [ ] La duración visible está entre 600 y 1.800 s; el preroll siempre es 90 s.
- [ ] El primer segundo visible dispone de 45 s de ritmo y 75 s de FC para las
  métricas, sin mostrar decisiones de preroll.
- [ ] `distanceM` es creciente y local; `gradePct` coincide con elevación y
  distancia de cada segundo.
- [ ] Un hueco >15 s genera señal degradada y nunca `increase_gently`.
- [ ] Con objetivo e historial ausentes, ninguna decisión real es
  `increase_gently`.
- [ ] Los cinco escenarios sintéticos y los 144 tests existentes siguen
  pasando.
- [ ] La UI muestra atribución, licencia, semilla, timestamps de ventana y
  limitaciones de RPE/síntomas/plan.

## Verificación manual inicial

Usar una semilla fija (por ejemplo `42`) durante desarrollo. Tras verificar el
importador, ejecutar varias semillas y revisar al menos una ventana de inicio,
una alrededor de la zona media y una final contra la repetición. Para cada una,
confirmar en resultados externos que el patrón de parciales es plausible y que
las decisiones de Jev no pretenden diagnosticar ni autorizar aumentos de
intensidad con contexto incompleto.

## Fuera de alcance de esta entrega

- Obtener o inferir RPE, síntomas, instrucciones del entrenador, estado de
  recuperación o historial privado de Iden.
- Usar temperatura corporal de Kristian Blummenfelt para explicar la carrera de
  Iden.
- Entrenar, ajustar umbrales fisiológicos o declarar precisión médica a partir
  de una sola carrera.
- Distribuir el raw dataset en un contexto comercial sin la licencia apropiada.
