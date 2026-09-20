# Carrera para consumidor: WHOOP, Amazfit, Xiaomi y Strava con decisiones Jev

La demo debe priorizar lo que una persona ya tiene: reloj o pulsera, móvil y Strava. Para carrera, las señales más útiles son ritmo, frecuencia cardiaca (FC), distancia/tiempo, elevación y percepción de esfuerzo (RPE). WHOOP añade contexto de recuperación. No requerimos banda pectoral ni potenciómetro.

> Decisión: Strava será la capa común de histórico y gráficas. Los datos en vivo solo llegarán desde una app o reloj compatible. Las decisiones combinan reglas de seguridad con juicios tipados de Jev; nunca dependen de una gráfica aislada ni de calorías.

## Experiencia de la primera demo

1. El corredor inicia carrera fácil, tempo o intervalos desde móvil/reloj.
2. La app recibe ritmo, FC y GPS cada pocos segundos cuando la fuente lo permite.
3. Compara una ventana de 60–90 segundos con el objetivo y el RPE del usuario.
4. Muestra: subir suave, mantener, bajar suave o recuperar.
5. Al acabar, importa/sincroniza Strava y presenta las gráficas de sesión y progreso.

El modo post-carrera sigue siendo útil: se importa una actividad de Strava y se explica qué ocurrió. No se debe prometer guía en directo antes de validar la fuente de datos y su latencia.

## Comparativa práctica

| Ecosistema | Datos que suele aportar | Uso más realista | Datos en vivo para terceros | Límite importante |
|---|---|---|---|---|
| **Strava** | Actividad, distancia, tiempo, ritmo/velocidad, elevación, FC, cadencia y streams cuando el archivo los trae | Historial unificado, gráficas, laps y análisis post-sesión | No como fuente primaria: los streams pertenecen a la actividad registrada | Depende del reloj y la sincronización; no todos los uploads incluyen FC/cadencia |
| **WHOOP** | Recovery, HRV, FC en reposo, sueño, strain diario; workout resumido | Contexto de recuperación del día y análisis posterior | No diseñar alrededor de telemetría continua de carrera desde su API pública | Sus scores son propietarios; Recovery no autoriza ni prohíbe automáticamente un entrenamiento |
| **Amazfit / Zepp** | FC, GPS, ritmo, distancia; carga/VO₂max/recuperación en equipos compatibles | Mejor candidato para experiencia en vivo con dispositivo compatible | Sí, de forma acotada, mediante Workout Extension de Zepp OS | La extensión depende del modelo y versión; comprobar antes de prometerla |
| **Xiaomi / Mi Fitness** | Carrera registrada: ruta, distancia, tiempo y, según reloj/exportación, FC/ritmo | Entrada económica: Mi Fitness → Strava → análisis común | No asumir API pública ni stream vivo de terceros | La sincronización con Strava existe, pero los campos transferidos pueden variar |

Fuentes: [Strava API v3](https://developers.strava.com/docs/reference/), [WHOOP API](https://developer.whoop.com/api/), [Zepp Workout Extension](https://docs.zepp.com/docs/guides/workout-extension/intro/) y [Mi Fitness–Strava](https://support.strava.com/en-us/articles/15401633-mi-fitness-and-strava).

## Las gráficas que necesita el producto

No crear un dashboard que muestre todo. Estas seis gráficas resuelven preguntas reales de quien corre.

| Gráfica | Pregunta | Datos | Interpretación |
|---|---|---|---|
| **Ritmo por tiempo** | ¿Mantuve el plan? | Ritmo suavizado, laps, objetivo | Principal. Marcar pausas y no interpretar picos aislados de GPS. |
| **FC sobre ritmo** | ¿Cuál fue el coste de ese ritmo? | FC, ritmo, zonas personales | FC sostenida al alza con ritmo comparable puede sugerir calor/fatiga: pedir contexto, no diagnosticar. |
| **Ritmo vs. FC por km** | ¿Fui más eficiente? | Media de ritmo y FC por lap | Comparar sesiones semejantes, no cuestas/temperaturas distintas. |
| **Elevación + ritmo** | ¿La pendiente explica el cambio? | Altitud/pendiente y ritmo | Evita penalizar una subida. |
| **Zonas y distribución** | ¿Cuánto fue fácil/medio/intenso? | Tiempo por zonas de FC o ritmo | Etiquetar cómo se calcula cada zona; permitir configuración. |
| **Tendencia semanal** | ¿Estoy progresando/acumulando carga? | Km, duración, sesiones, RPE, ritmo/FC comparable | Mostrar tendencia y notas; no inferir lesión con un único ratio. |

### Datos específicos que merecen mostrarse

- **WHOOP:** tarjeta de contexto con Recovery, HRV, FC reposo, sueño y Strain, siempre como tendencia de 7–28 días.
- **Amazfit/Zepp:** FC, ritmo, distancia, laps y mapa primero. VO₂max, Training Load, Training Effect y Recovery Time se etiquetan como estimaciones de fabricante.
- **Xiaomi/Mi Fitness:** mapa, ritmo, duración, distancia y FC si llegó al archivo. Si Strava no recibe FC/cadencia, mostrar la ausencia; no inventarla.
- **Strava:** actividad y streams disponibles para reconstruir nuestras gráficas. Un stream ausente debe quedar ausente.

## Métricas mínimas para carrera

| Prioridad | Métrica | Uso |
|---|---|---|
| 1 | Ritmo/velocidad suavizada | Media móvil de 30–60 s contra el rango del bloque |
| 1 | FC | Ventana de 60–90 s; no reaccionar a un salto puntual |
| 1 | Objetivo del bloque | Sin objetivo no existe “más rápido = mejor” |
| 1 | RPE 0–10 y dolor/síntomas | Check-in al inicio, cambios de bloque e incoherencias |
| 2 | Distancia, tiempo, laps | Dosis de sesión y transición de bloques |
| 2 | Elevación/pendiente | Reduce agresividad en cambios de terreno |
| 3 | Cadencia | Feedback descriptivo; no imponer un óptimo universal |
| Contexto | Sueño, HRV, FC reposo, Recovery/Strain | Modifica prudencia inicial, no controla cada segundo |
| Excluir de decisiones | Calorías, pasos, SpO₂, VO₂max, readiness | Mostrar como contexto; nunca justificar subir intensidad |

Los wearables de consumo pueden servir para tendencias de FC y pasos, pero el gasto energético tiene un error relevante y las métricas derivadas cambian según dispositivo y actividad. [Revisión paraguas](https://pubmed.ncbi.nlm.nih.gov/39080098/). La FC óptica puede degradarse por artefactos de movimiento; la interfaz debe mostrar calidad de señal y no hacer recomendaciones agresivas. [Metaanálisis de PPG](https://pubmed.ncbi.nlm.nih.gov/32552580/).

## Semáforo de carrera: reglas antes de IA

| Estado | Condición sostenida | Acción |
|---|---|---|
| Verde | Ritmo en objetivo; FC y RPE esperados | Mantén este ritmo |
| Azul | Bloque fácil; ritmo bajo durante 60–90 s; FC/RPE bajos; GPS fiable | Puedes subir ligeramente durante un minuto |
| Ámbar | FC/RPE altos para ritmo comparable, o pendiente/calor/pausa explican la desviación | Mantén o baja un poco; revisa sensaciones |
| Rojo | Dolor torácico, desmayo/mareo notable, falta de aire inusual, alerta manual o sensor inválido | Detener; buscar ayuda según gravedad. Jev no puede autorizar continuar |
| Gris | Sin FC, GPS/ritmo inválido o sincronización solo post-entreno | Sin datos fiables para cambiar intensidad |

La referencia 50–85 % de FCmáx estimada solo es una orientación general; la AHA advierte que es un promedio y que medicación o cardiopatías cambian el objetivo individual. [American Heart Association](https://www.heart.org/en/healthy-living/exercise-and-physical-activity/fitness-basics/target-heart-rates).

## Jev / TypeSafe AI: la integración correcta

Jev es el modelo System One de TypeSafe: recibe estado y preguntas tipadas y devuelve elecciones, probabilidades y confianza. No es un generador de explicaciones largas. El código retiene reglas, cálculos y límites. [Introducción](https://docs.typesafe.ai/introduction), [Choice](https://docs.typesafe.ai/primitives/choice) y [Confidence](https://docs.typesafe.ai/confidence).

Jev no decide valores numéricos de ritmo ni diagnostica. Sirve para resolver ambigüedad contextual:

1. El backend calcula diferencia con objetivo, tendencia de FC, pendiente, frescura y calidad de datos.
2. Si una regla de seguridad o calidad bloquea la acción, termina ahí.
3. Jev responde preguntas independientes sobre el estado reducido.
4. El backend combina elección, probabilidades, confianza y límites predefinidos.
5. La interfaz usa una plantilla para el mensaje.

### Estado mínimo para Jev

~~~ts
const state = {
  sport: "running",
  workoutBlock: "easy", // easy | tempo | interval | recovery
  targetPaceSecKm: { low: 330, high: 350 },
  latestWindow: {
    paceSecKm: 361,
    paceVsTargetSeconds: 11,
    heartRateBpm: 142,
    heartRateTrendBpmPerMin: 1.2,
    gradePct: 0.4,
    signalQuality: "high",
    dataAgeSeconds: 2,
  },
  athleteContext: {
    rpe: 3,
    reportedSymptoms: false,
    todayRecovery: "below_usual", // categoría derivada, no score crudo
  },
  safety: { hardStop: false, mayIncreaseIntensity: true },
};
~~~

No incluir rutas completas, identificadores, histórico médico ni scores propietarios crudos si una categoría derivada basta.

### Preguntas tipadas

- **Choice: acción de esfuerzo.** Opciones cerradas: increase_gently, maintain, decrease_gently, recovery e insufficient_evidence.
- **Noul: esfuerzo desproporcionado.** Pregunta si, con objetivo, FC/RPE/tendencia y pendiente, el esfuerzo parece excesivo; no si existe una enfermedad.
- **Choice: explicación de contexto.** uphill, warm_or_fatigued, pace_below_target, normal_variation o insufficient_data. Selecciona una plantilla de explicación.
- **Score: fiabilidad de datos.** Niveles unusable, limited y reliable. El código solo actúa si el resultado y la confianza lo permiten.

~~~ts
const questions = {
  effort_action: {
    type: "choice",
    instructions:
      "Para el bloque de carrera actual, elige la acción conservadora que encaja con los datos. No diagnostiques ni ignores safety.",
    criteria: {
      increase_gently: "Solo bloque easy, ritmo sostenidamente bajo, esfuerzo bajo, señal fiable y safety permite aumentar.",
      maintain: "Ritmo y esfuerzo encajan con el objetivo, o la variación es normal.",
      decrease_gently: "El esfuerzo parece mayor de lo deseado para el bloque, sin emergencia.",
      recovery: "El bloque intenso no se está tolerando y debe pasar a recuperación.",
      insufficient_evidence: "Faltan datos, la señal es vieja/ruidosa o el contexto no permite actuar.",
    },
  },
  effort_looks_disproportionate: {
    type: "noul",
    instructions:
      "¿El esfuerzo aparente es desproporcionado para este bloque y ritmo considerando FC, RPE, pendiente y calidad de datos?",
    criteria: "No diagnosticar condiciones médicas; responder solo sobre entrenamiento.",
  },
};
~~~

TypeSafe permite enviar preguntas independientes en paralelo. Para una acción que afecta a la intensidad no basta con Choice: el backend también comprueba safety, frescura de señal y umbrales de confianza. La confianza mide cómo se concentran las probabilidades de una respuesta; no es certeza clínica.

### Política de composición

~~~text
hardStop o señal no fiable                 → gris/rojo; no intensificar
acción = insufficient_evidence             → gris; pedir RPE o esperar ventana
confianza baja                             → mantener; no cambiar ritmo
acción = increase_gently + reglas cumplen  → incremento máximo predefinido
acción = decrease/recovery                 → bajar y reevaluar con mensaje plantilla
~~~

Registrar estado, preguntas, probabilidades, confianza, regla aplicada y resultado. Con sesiones revisadas por un entrenador se ajustan los umbrales; Jev no se convierte en una caja negra.

## Arquitectura por fases

| Fase | Datos | Experiencia | Objetivo |
|---|---|---|---|
| 1. Post-carrera | Strava e importaciones disponibles | Gráficas + adherencia al plan | Validar utilidad visual |
| 2. Semivivo móvil | GPS/FC de móvil o reloj compatible; RPE manual | Avisos cada 60–90 s | Validar señal, estabilidad y aceptación |
| 3. En vivo reloj | Zepp Workout Extension u otra integración confirmada | Indicaciones por bloques | Validar latencia/UX |
| 4. Personalización | Histórico Strava + tendencia propia/WHOOP | Objetivos y prudencia individualizados | Evaluar contra expertos y feedback |

## Casos de prueba

| Caso | Resultado esperado |
|---|---|
| Xiaomi sincroniza a Strava sin FC | Mostrar ritmo/distancia/mapa; semáforo gris para cambios basados en FC |
| WHOOP Recovery bajo + carrera fácil con buen RPE | Contexto conservador; nunca bloqueo automático |
| Ritmo lento por cuesta | Pendiente explica la desviación; no subir agresivamente |
| FC con salto o dato de 30 s | Calidad baja; mantener o revisar reloj |
| RPE 8/10 con ritmo fácil | Bajar/recuperar y check-in aunque el reloj parezca normal |
| Síntoma crítico | Detener; no consultar a Jev para permitir continuar |
| Actividad Strava completa | Reconstruir las seis gráficas y etiquetar campos ausentes |

## Fuentes

1. [WHOOP Developer API](https://developer.whoop.com/api/) — recovery, ciclos, workouts y sueño.
2. [Zepp OS Workout Extension](https://docs.zepp.com/docs/guides/workout-extension/intro/) y [Workout sensor](https://docs.zepp.com/docs/reference/device-app-api/newAPI/sensor/Workout/) — indicadores de entrenamiento y disponibilidad por modelo.
3. [Strava API v3](https://developers.strava.com/docs/reference/) — actividades, streams, OAuth y alcance de datos.
4. [Strava Help: Mi Fitness](https://support.strava.com/en-us/articles/15401633-mi-fitness-and-strava) — sincronización oficial Xiaomi–Strava.
5. [TypeSafe AI](https://docs.typesafe.ai/introduction) — Jev, System One, Choice, Noul, Score y confianza.
6. [Revisión de precisión de wearables](https://pubmed.ncbi.nlm.nih.gov/39080098/) y [PPG de muñeca](https://pubmed.ncbi.nlm.nih.gov/32552580/) — límites que condicionan el diseño.

## Siguiente decisión

La ruta más accesible es Strava como capa común, V1 post-carrera y modo en vivo solo para hardware confirmado. Para un piloto de feedback en directo, elegir un Amazfit compatible con Workout Extension. Para accesibilidad y análisis post-carrera, elegir Xiaomi + Strava.

## Alcance de la demo simulada

Antes de integrar hardware, la demo debe reproducir una carrera ficticia segundo a segundo, con señales de ritmo, FC, pendiente, RPE y calidad. También debe variar el historial de 0 a 10 sesiones comparables: sin historial la recomendación depende del plan actual y se vuelve más conservadora; con 4–10 sesiones puede comparar contra una referencia personal de ritmo, FC y RPE. La trazabilidad debe conservar qué se observó, qué guardas actuaron, qué juzgó Jev y qué decisión final produjo cada segundo. El prompt de implementación está en [desarrollar-demo-carrera-jev.md](../prompts/desarrollar-demo-carrera-jev.md).
