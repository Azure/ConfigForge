# ConfigForge localization review

## Suggested workflow for Amir

1. Run `node scripts/review-locales.mjs --strict` after any translation edit.
2. Review high-traffic surfaces first: sidebar, common buttons, settings, home, and manifest editor toolbar.
3. Mark approved namespaces in your tracking system, not in catalog files; keep JSON values clean product text.
4. File revisions against the namespace/key shown below, then rerun this report before v0.3.61 QA polish.

## Coverage

| Locale | Translated | Fallback/TODO | Total | Coverage |
|---|---:|---:|---:|---:|
| fr | 774 | 59 | 833 | 92.9% |
| de | 772 | 61 | 833 | 92.7% |
| es | 779 | 54 | 833 | 93.5% |

## Placeholder integrity check

✅ Clean — all `{{placeholder}}` names and counts match English.

## Length analysis

Layout warnings (>150% of English): **74**

### fr: 20 longest values

| Namespace | Key | Chars | EN chars | Ratio | Value |
|---|---|---:|---:|---:|---|
| settings | systemHealth.elevation.description | 411 | 318 | 129% | L’audit et l’application des baselines nécessitent des droits administrateur pour lire et écrire les valeurs de Registre protégées, les stratégies CSP et la configuration système.  |
| manifest-editor | deploy.enforceRiskConfirm | 406 | 328 | 124% | AVERTISSEMENT : Appliquera les paramètres à cet appareil.<br><br>Cette action peut modifier la politique de sécurité de Windows ou Linux de manière à perturber la connexion, le réseau, l |
| manifest-editor | actions.revertConfirm | 336 | 310 | 108% | Reviens baseline « {{name}} » ?<br><br>Si un instantané pré-déploiement existe, vos paramètres précédents seront réappliqués sur cet appareil. Si aucun snapshot n’existe, OSConfig applic |
| manifests | confirm.revert | 296 | 269 | 110% | Annuler « {{name}} » ?<br><br>Si un instantané pré-déploiement existe, vos paramètres précédents seront réappliqués sur cet appareil. Si aucun snapshot n’existe, OSConfig application ser |
| dialogs | cli-required.body | 266 | 223 | 119% | <feature>{{feature}}</feature> nécessite l’installation du CLI OSConfig sur cet appareil. L’éditeur, la bibliothèque et les outils de différence/comparaison de ConfigForge fonction |
| home | editorMode.sectionDescription | 264 | 207 | 128% | ConfigForge est entièrement utilisable pour l’édition, les différences, la comparaison et l’export. Déployer / Auditer / Rétablir sur cet appareil nécessite OSConfig installé local |
| manifests | card.stats.couldNotReadTitle | 252 | 221 | 114% | Paramètres que l’audit n’a pas pu lire (fournisseur non supporté, erreur de transport ou chemin non pris en charge). Ces problèmes ne sont pas considérés — l’appareil peut déjà êtr |
| manifest-editor | deployResult.couldNotReadTitle | 245 | 184 | 133% | Paramètres que la ligne de ligne de ligne ne pouvait pas lire (fournisseur non supporté, erreur de transport, ou chemin non pris en charge). Ces éléments ne sont PAS comptés comme  |
| cis-catalog | extracted.text42 | 231 | 195 | 118% | Le contenu des référentiels CIS est la propriété intellectuelle du Center for Internet Security et fait l'objet d'une licence distincte. ConfigForge fournit la logique de correspon |
| settings | about.authorFlavor | 226 | 150 | 151% ⚠️ | Développez l’ambiance : auteur. Baseline uniquement pour l’édition, la comparaison de la bibliothèque, la comparaison de conformité et le pack d’audit en PDF. Utilisez la version W |
| diff | info.oneManifest | 220 | 189 | 116% | Vous avez 1 baseline enregistré. Pour comparer deux baselines enregistrés, enregistrez d’abord un second, ou passez de chaque côté en mode <strong>Collage / Téléversement</strong>  |
| audit-pack | extracted.text21 | 216 | 174 | 124% | Le audit pack est un document autonome. Partagez le PDF directement avec les auditeurs. Les téléchargements incluent un pied de page avec des numéros de page et une marque « Confid |
| compliance | perManifest.extracted.text4 | 216 | 192 | 113% | ConfigForge ne redistribue pas CIS contenu Benchmark (restrictions de licence). Le rapport de pourcentage de conformité compare votre baseline à un CIS baseline, ce qui nécessite l |
| home | firstRun.sectionDescription | 215 | 185 | 116% | ConfigForge va à l’encontre de OSConfig baselines. Parcourez les Baselines Microsoft inclus (WS2019/2022/2025 rôles serveur, Defender, LAPS) pour trouver du contenu prêt à utiliser |
| welcome | authorIntro | 213 | 181 | 118% | Créez des baselines de sécurité OSConfig directement depuis votre Mac. La version auteur inclut la bibliothèque de baselines Microsoft, l’édition, la validation, la comparaison et  |
| cis-catalog | extracted.text2 | 207 | 175 | 118% | Recoupez vos paramètres de OSConfig avec CIS règles de benchmark. Déposez vos fichiers CIS dans le dossier ci-dessous et l’éditeur affichera les règles correspondantes pendant que  |
| common | health.version-mismatch-hint | 198 | 162 | 122% | ConfigForge a été validé avec {{expectedVersion}}. Le CLI installé peut produire des erreurs inattendues pendant le déploiement ou l’audit. Mettez OSConfig à niveau si vous rencont |
| cis-catalog | extracted.text32 | 197 | 166 | 119% | (Azure Policy > Configuration de la machine > CIS). Laisse tomber le JSON tel quel. L’application détecte la plateforme (Windows / Linux) et associe les règles à vos paramètres de  |
| manifest-editor | actions.revertTitle | 193 | 166 | 116% | Annulez le dernier déploiement de ce baseline depuis cet appareil. Si un instantané pré-déploiement existe, les réglages précédents sont réappliqués ; sinon, OSConfig application e |
| diff | matrix.sectionDescription | 190 | 150 | 127% | Chaque ligne de la matrice résultante est un réglage ; chaque colonne est une baseline. Les cellules sont codées par couleur verte (identique), rouge (différent) ou jaune (seulemen |

### de: 20 longest values

| Namespace | Key | Chars | EN chars | Ratio | Value |
|---|---|---:|---:|---:|---|
| manifest-editor | deploy.enforceRiskConfirm | 435 | 328 | 133% | WARNUNG: Enforce wird Einstellungen auf dieses Gerät ANWENDEN.<br><br>Diese Maßnahme kann die Sicherheitsrichtlinien von Windows oder Linux so verändern, dass Login, Netzwerke, RDP oder  |
| settings | systemHealth.elevation.description | 399 | 318 | 125% | Das Auditieren und Anwenden baselines erfordert Administratorrechte zum Lesen und Schreiben geschützter Registerwerte, CSP-Richtlinien und Systemkonfiguration. Klicken Sie unten, u |
| manifest-editor | actions.revertConfirm | 359 | 310 | 116% | Zurücksetzen baseline "{{name}}"?<br><br>Wenn ein Pre-Deploy-Snapshot vorhanden ist, werden deine vorherigen Einstellungen auf dieses Gerät erneut angewendet. Wenn kein Snapshot vorhande |
| manifests | confirm.revert | 319 | 269 | 119% | "Zurücksetzen"-{{name}}"?<br><br>Wenn ein Pre-Deploy-Snapshot vorhanden ist, werden deine vorherigen Einstellungen auf dieses Gerät erneut angewendet. Wenn kein Snapshot existiert, wird  |
| manifests | card.stats.couldNotReadTitle | 280 | 221 | 127% | Einstellungen, die das Audit nicht lesen konnte (Anbieter nicht unterstützt, Transportfehler oder nicht unterstützter Pfad). Diese werden nicht als Probleme gezählt – das Gerät kan |
| dialogs | cli-required.body | 260 | 223 | 117% | <feature>{{feature}}</feature> erfordert, dass die OSConfig CLI auf diesem Gerät installiert ist. Editor, Bibliothek und Diff-/Vergleichswerkzeuge von ConfigForge funktionieren ohn |
| home | editorMode.sectionDescription | 227 | 207 | 110% | ConfigForge ist vollständig nutzbar zum Authoring, Diff, Compare und Export. Deploy / Audit / Revert gegen dieses Gerät erfordert OSConfig lokal installiert. Installiere es jederze |
| manifest-editor | deployResult.couldNotReadTitle | 227 | 184 | 123% | Einstellungen, die die CLI nicht lesen konnte (Anbieter nicht unterstützt, Transportfehler oder nicht unterstützter Pfad). Diese werden NICHT als nicht konform gewertet. Das Gerät  |
| diff | info.oneManifest | 219 | 189 | 116% | Sie haben 1 baseline registriert. Um zwei registrierte baselines zu vergleichen, registrieren Sie zuerst ein zweites oder schalten Sie unten in <strong>den Modus Einfügen / Hochlad |
| manifest-editor | actions.revertTitle | 216 | 166 | 130% | Die letzte Bereitstellung dieses baseline von diesem Gerät rückgängig machen. Wenn ein Pre-Deploy-Snapshot existiert, werden vorherige Einstellungen erneut angewendet; ansonsten wi |
| cis-catalog | extracted.text32 | 213 | 166 | 128% | (Azure Policy > Maschinenkonfiguration > CIS). Lass die JSON so fallen, wie sie ist. Die App erkennt die Plattform (Windows / Linux) und ordnet die Regeln anhand deiner baseline Ei |
| home | firstRun.sectionDescription | 213 | 185 | 115% | ConfigForge wirkt gegen OSConfig baselines. Durchstöbern Sie das mitgelieferte Microsoft Baselines (WS2019/2022/2025 Serverrollen, Defender, LAPS) für einsatzbereite Inhalte oder r |
| cis-catalog | extracted.text2 | 207 | 175 | 118% | Vergleiche deine OSConfig-Einstellungen mit CIS Benchmark-Regeln. Fügen Sie Ihre CISDateien in den folgenden Ordner ein, und der Editor zeigt entsprechende Regeln an, während Sie s |
| home | interrupted.description | 206 | 141 | 146% | Ihr Gerät befindet sich möglicherweise in einem teilweise angelegten state{{startedAt}}. Führen Sie ein Audit durch, um die aktuelle Compliance zu überprüfen, oder kehren Sie zum P |
| welcome | authorIntro | 204 | 181 | 113% | Erstellen Sie OSConfig-Sicherheitsbaselines direkt auf Ihrem Mac. Die Author-Version enthält die Microsoft-Baselinebibliothek sowie Bearbeitung, Validierung, Vergleich und Export — |
| audit-pack | extracted.text21 | 203 | 174 | 117% | Die audit pack ist ein in sich geschlossenes Dokument. Teile das PDF direkt mit den Prüfern. Downloads enthalten einen Footer mit Seitenzahlen und eine Markierung "Vertraulich – Nu |
| cis-catalog | extracted.text42 | 201 | 195 | 103% | CIS-Benchmark-Inhalte sind geistiges Eigentum des Center for Internet Security und werden separat lizenziert. ConfigForge stellt die Zuordnungslogik bereit, enthält jedoch keine CI |
| compliance | perManifest.extracted.text4 | 201 | 192 | 105% | ConfigForge verbreitet keine CIS Benchmark-Inhalte (Lizenzeinschränkungen). Der Compliance-%-Bericht vergleicht Ihre baseline mit einer CIS baseline, die die Katalogdateien auf der |
| history | restore.warning | 195 | 149 | 131% | Das aktuelle baseline wird vor der Wiederherstellung automatisch aufgenommen, damit du zurücksetzen kannst. Eine Neuregistrierung kann den gewünschten Zustand auf verwaltete Geräte |
| common | health.version-mismatch-hint | 194 | 162 | 120% | ConfigForge wurde mit {{expectedVersion}} validiert. Die installierte CLI kann während Bereitstellung oder Audit unerwartete Fehler erzeugen. Aktualisieren Sie OSConfig, wenn Probl |

### es: 20 longest values

| Namespace | Key | Chars | EN chars | Ratio | Value |
|---|---|---:|---:|---:|---|
| manifest-editor | deploy.enforceRiskConfirm | 424 | 328 | 129% | ADVERTENCIA: Enforcer APLICARÁ configuraciones a este dispositivo.<br><br>Esta acción puede modificar la política de seguridad de Windows o Linux de formas que puedan romper el inicio de |
| settings | systemHealth.elevation.description | 387 | 318 | 122% | La auditoría y aplicación de baselines requiere derechos de administrador para leer y escribir valores protegidos del registro, políticas CSP y configuración del sistema. Haz clic  |
| manifest-editor | actions.revertConfirm | 341 | 310 | 110% | ¿Revertir baseline "{{name}}"?<br><br>Si existe una instantánea previa al despliegue, tus ajustes previos se volverán a aplicar a este dispositivo. Si no existe una instantánea, OSConfig |
| manifests | confirm.revert | 295 | 269 | 110% | ¿Revertir "{{name}}"?<br><br>Si existe una instantánea previa al despliegue, tus ajustes previos se volverán a aplicar a este dispositivo. Si no existe una instantánea, OSConfig aplicaci |
| dialogs | cli-required.body | 270 | 223 | 121% | <feature>{{feature}}</feature> requiere que la CLI de OSConfig esté instalada en este dispositivo. El editor, la biblioteca y las herramientas de diferencias/comparación de ConfigF |
| home | editorMode.sectionDescription | 264 | 207 | 128% | ConfigForge es totalmente utilizable para autoría, diferencias, comparación y exportación. Desplegar / Auditar / Revertir contra este dispositivo requiere OSConfig instalado localm |
| manifests | card.stats.couldNotReadTitle | 236 | 221 | 107% | Ajustes que la auditoría no pudo leer (proveedor no soportado, error de transporte o ruta no soportada). Estos no se cuentan como problemas: el dispositivo puede estar ya en el est |
| compliance | perManifest.extracted.text4 | 213 | 192 | 111% | ConfigForge no redistribuye CIS contenido de Benchmark (restricciones de licencia). El informe de porcentaje de cumplimiento compara tu baseline con un CIS baseline, que requiere l |
| manifest-editor | actions.revertTitle | 213 | 166 | 128% | Deshacer el último despliegue de este baseline desde este dispositivo. Si existe una instantánea previa al despliegue, se vuelven a aplicar configuraciones previas; de lo contrario |
| cis-catalog | extracted.text42 | 211 | 195 | 108% | El contenido de CIS Benchmark es propiedad intelectual del Center for Internet Security y se licencia por separado. ConfigForge incluye la lógica de coincidencia, pero no incluye n |
| audit-pack | extracted.text21 | 209 | 174 | 120% | El audit pack es un documento independiente. Comparte el PDF directamente con los auditores. Las descargas incluyen un pie de página con números de página y una marca de "Confidenc |
| home | firstRun.sectionDescription | 206 | 185 | 111% | ConfigForge juega en contra de OSConfig baselines. Consulta el Baselines incluido de Microsoft (WS2019/2022/2025 roles de servidor, Defender, LAPS) para contenido listo para usar,  |
| welcome | authorIntro | 200 | 181 | 110% | Cree baselines de seguridad de OSConfig directamente desde su Mac. La versión de autor incluye la biblioteca de baselines de Microsoft, edición, validación, comparación y exportaci |
| manifest-editor | deployResult.couldNotReadTitle | 199 | 184 | 108% | Ajustes que la CLI no podía leer (proveedor no soportado, error de transporte o ruta no soportada). Estos NO se cuentan como no cumplientes. El dispositivo puede estar realmente en |
| diff | info.oneManifest | 194 | 189 | 103% | Tienes 1 baseline registrado. Para comparar dos baselines registrados, primero regístra un segundo, o cambia a cada lado a modo <strong>Pegar / Subir</strong> abajo para pegar YAML |
| cis-catalog | extracted.text2 | 192 | 175 | 110% | Contrasta tus ajustes de OSConfig con las reglas de CIS Benchmark. Coloca tus archivos CIS en la carpeta de abajo y el editor mostrará las reglas correspondientes mientras navegas  |
| history | restore.noCurrent | 188 | 140 | 134% | No se encontró ningún baseline registrado actualmente, por lo que no se creará una instantánea automática. La restauración registrará el contenido de la instantánea como un nuevo b |
| settings | systemHealth.install.description | 188 | 153 | 123% | El editor, la biblioteca y las características de diferencia/comparación de ConfigForge funcionan sin la CLI. Instala OSConfig para habilitar Desplegar, Auditar y Revertir en esta  |
| diff | matrix.sectionDescription | 186 | 150 | 124% | Cada fila en la matriz resultante es un ajuste; Cada columna es una baseline. Las celdas están codificadas por colores verde (idéntica), roja (diferente) o amarilla (solo en la ent |
| settings | about.authorFlavor | 185 | 150 | 123% | Construye sabor: autor. Baseline solo edición, biblioteca, comparación de cumplimiento y paquete de auditoría en PDF. Usa la versión de Windows o Linux para desplegar en un disposi |

## Glossary violations

✅ Clean — protected terms remain literal where they appear in English.

## Plural form check

✅ Clean — plural-suffixed keys present in all target catalogs.

## Glossary terms

- ConfigForge
- Azure Local
- OSConfig
- CIS
- XCCDF
- OVAL
- Azure Policy
- MOF
- YAML
- JSON
- audit pack
- ALDO
- baseline

