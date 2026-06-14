# ConfigForge localization review

## Suggested workflow for Amir

1. Run `node scripts/review-locales.mjs --strict` after any translation edit.
2. Review high-traffic surfaces first: sidebar, common buttons, settings, home, and manifest editor toolbar.
3. Mark approved namespaces in your tracking system, not in catalog files; keep JSON values clean product text.
4. File revisions against the namespace/key shown below, then rerun this report before v0.3.61 QA polish.

## Coverage

| Locale | Translated | Fallback/TODO | Total | Coverage |
|---|---:|---:|---:|---:|
| fr | 773 | 56 | 829 | 93.2% |
| de | 774 | 55 | 829 | 93.4% |
| es | 781 | 48 | 829 | 94.2% |

## Placeholder integrity check

✅ Clean — all `{{placeholder}}` names and counts match English.

## Length analysis

Layout warnings (>150% of English): **77**

### fr: 20 longest values

| Namespace | Key | Chars | EN chars | Ratio | Value |
|---|---|---:|---:|---:|---|
| settings | systemHealth.elevation.description | 411 | 318 | 129% | L’audit et l’application des baselines nécessitent des droits administrateur pour lire et écrire les valeurs de Registre protégées, les stratégies CSP et la configuration système.  |
| manifest-editor | deploy.enforceRiskConfirm | 406 | 328 | 124% | AVERTISSEMENT : Appliquera les paramètres à cet appareil.<br><br>Cette action peut modifier la politique de sécurité de Windows ou Linux de manière à perturber la connexion, le réseau, l |
| manifest-editor | actions.revertConfirm | 345 | 310 | 111% | Annuler la manifestation « {{name}} » ?<br><br>Si un instantané pré-déploiement existe, vos paramètres précédents seront réappliqués sur cet appareil. Si aucun instantané n’existe, OSCon |
| manifests | confirm.revert | 301 | 269 | 112% | Annuler « {{name}} » ?<br><br>Si un instantané pré-déploiement existe, vos paramètres précédents seront réappliqués sur cet appareil. Si aucun snapshot n’existe, OSConfig application ser |
| manifests | card.stats.couldNotReadTitle | 267 | 222 | 120% | Ressources que l'audit n'a pas pu lire (fournisseur non pris en charge, erreur de transport ou chemin non pris en charge). Elles ne sont pas comptées comme des problèmes — l'appare |
| dialogs | cli-required.body | 266 | 223 | 119% | <feature>{{feature}}</feature> nécessite l’installation du CLI OSConfig sur cet appareil. L’éditeur, la bibliothèque et les outils de différence/comparaison de ConfigForge fonction |
| home | editorMode.sectionDescription | 264 | 207 | 128% | ConfigForge est entièrement utilisable pour l’édition, les différences, la comparaison et l’export. Déployer / Auditer / Rétablir sur cet appareil nécessite OSConfig installé local |
| cis-catalog | extracted.text42 | 231 | 195 | 118% | Le contenu des référentiels CIS est la propriété intellectuelle du Center for Internet Security et fait l'objet d'une licence distincte. ConfigForge fournit la logique de correspon |
| manifest-editor | deployResult.couldNotReadTitle | 224 | 185 | 121% | Ressources que la CLI ne pouvait pas lire (fournisseur non supporté, erreur de transport ou chemin non pris en charge). Ces éléments ne sont PAS comptés comme non conformes. L’appa |
| diff | info.oneManifest | 223 | 189 | 118% | Vous avez un manifeste enregistré. Pour comparer deux manifestes enregistrés, enregistrez d’abord un second, ou passez de chaque côté en mode <strong>Collage / Téléversement</stron |
| compliance | perManifest.extracted.text4 | 217 | 192 | 113% | ConfigForge ne redistribue pas CIS contenu Benchmark (restrictions de licence). Le rapport de pourcentage de conformité compare votre manifeste à un CIS baseline, ce qui nécessite  |
| audit-pack | extracted.text21 | 216 | 174 | 124% | Le audit pack est un document autonome. Partagez le PDF directement avec les auditeurs. Les téléchargements incluent un pied de page avec des numéros de page et une marque « Confid |
| home | firstRun.sectionDescription | 216 | 182 | 119% | ConfigForge fonctionne avec les manifestes OSConfig. Parcourez la bibliothèque de baselines intégrée (rôles serveur WS2019/2022/2025, Defender, LAPS) pour du contenu prêt à l’emplo |
| cis-catalog | extracted.text2 | 205 | 176 | 116% | Recoupez vos ressources OSConfig avec les règles CIS Benchmark. Déposez vos fichiers CIS dans le dossier ci-dessous : l'éditeur affichera les règles correspondantes au fil de votre |
| cis-catalog | extracted.text32 | 201 | 167 | 120% | (Azure Policy > Machine Configuration > CIS). Déposez le JSON tel quel. L'application détecte la plateforme (Windows / Linux) et fait correspondre les règles à vos ressources de ma |
| common | health.version-mismatch-hint | 198 | 162 | 122% | ConfigForge a été validé avec {{expectedVersion}}. Le CLI installé peut produire des erreurs inattendues pendant le déploiement ou l’audit. Mettez OSConfig à niveau si vous rencont |
| manifest-editor | actions.revertTitle | 194 | 166 | 117% | Annulez le dernier déploiement de ce manifeste depuis cet appareil. Si un instantané pré-déploiement existe, les réglages précédents sont réappliqués ; sinon, OSConfig application  |
| diff | matrix.sectionDescription | 190 | 150 | 127% | Chaque ligne de la matrice résultante est un réglage ; chaque colonne est une baseline. Les cellules sont codées par couleur verte (identique), rouge (différent) ou jaune (seulemen |
| history | restore.warning | 189 | 149 | 127% | Le manifeste actuel sera instantané automatiquement avant la restauration, vous pourrez donc revenir en arrière. Le réenregistrement peut redéployer l’état souhaité sur les apparei |
| settings | systemHealth.install.description | 188 | 153 | 123% | L’éditeur, la bibliothèque et les fonctions différence/comparaison de ConfigForge fonctionnent sans le CLI. Installez OSConfig pour activer Déployer, Auditer et Rétablir sur cette  |

### de: 20 longest values

| Namespace | Key | Chars | EN chars | Ratio | Value |
|---|---|---:|---:|---:|---|
| manifest-editor | deploy.enforceRiskConfirm | 435 | 328 | 133% | WARNUNG: Enforce wird Einstellungen auf dieses Gerät ANWENDEN.<br><br>Diese Maßnahme kann die Sicherheitsrichtlinien von Windows oder Linux so verändern, dass Login, Netzwerke, RDP oder  |
| settings | systemHealth.elevation.description | 399 | 318 | 125% | Das Auditieren und Anwenden baselines erfordert Administratorrechte zum Lesen und Schreiben geschützter Registerwerte, CSP-Richtlinien und Systemkonfiguration. Klicken Sie unten, u |
| manifest-editor | actions.revertConfirm | 347 | 310 | 112% | Manifestiere "{{name}}"?<br><br>Wenn ein Pre-Deploy-Snapshot vorhanden ist, werden deine vorherigen Einstellungen auf dieses Gerät erneut angewendet. Wenn kein Snapshot existiert, wird O |
| manifests | confirm.revert | 311 | 269 | 116% | "Zurücksetzen"-{{name}}"?<br><br>Wenn ein Pre-Deploy-Snapshot vorhanden ist, werden deine vorherigen Einstellungen auf dieses Gerät erneut angewendet. Wenn kein Snapshot vorhanden ist, w |
| manifests | card.stats.couldNotReadTitle | 279 | 222 | 126% | Ressourcen, die das Audit nicht lesen konnte (Anbieter nicht unterstützt, Übertragungsfehler oder nicht unterstützter Pfad). Sie zählen nicht als Probleme — das Gerät ist möglicher |
| dialogs | cli-required.body | 260 | 223 | 117% | <feature>{{feature}}</feature> erfordert, dass die OSConfig CLI auf diesem Gerät installiert ist. Editor, Bibliothek und Diff-/Vergleichswerkzeuge von ConfigForge funktionieren ohn |
| home | editorMode.sectionDescription | 227 | 207 | 110% | ConfigForge ist vollständig nutzbar zum Authoring, Diff, Compare und Export. Deploy / Audit / Revert gegen dieses Gerät erfordert OSConfig lokal installiert. Installiere es jederze |
| diff | info.oneManifest | 226 | 189 | 120% | Du hast eine registrierte Manifestliste. Um zwei registrierte Manifeste zu vergleichen, registrieren Sie zuerst ein zweites oder schalten Sie unten in <strong>den Modus Einfügen /  |
| manifest-editor | deployResult.couldNotReadTitle | 224 | 185 | 121% | Ressourcen, die die CLI nicht lesen konnte (Anbieter nicht unterstützt, Transportfehler oder nicht unterstützter Pfad). Diese werden NICHT als nicht konform gewertet. Das Gerät kön |
| home | firstRun.sectionDescription | 219 | 182 | 120% | ConfigForge wirkt gegen OSConfig Manifestationen. Durchstöbern Sie die mitgelieferte baseline-Bibliothek (WS2019/2022/2025 Server Roles, Defender, LAPS) für einsatzbereite Inhalte  |
| manifest-editor | actions.revertTitle | 217 | 166 | 131% | Die letzte Bereitstellung dieses Manifests von diesem Gerät rückgängig machen. Wenn ein Pre-Deploy-Snapshot existiert, werden vorherige Einstellungen erneut angewendet; ansonsten w |
| compliance | perManifest.extracted.text4 | 213 | 192 | 111% | ConfigForge verbreitet CIS Benchmark-Inhalte nicht weiter (Lizenzbeschränkungen). Der Compliance-Prozent-Bericht vergleicht dein Manifest mit einem CIS baseline, das die Katalogdat |
| cis-catalog | extracted.text32 | 207 | 167 | 124% | (Azure Policy > Machine Configuration > CIS) herunter. Legen Sie das JSON unverändert ab. Die App erkennt die Plattform (Windows / Linux) und ordnet die Regeln Ihren Manifest-Resso |
| home | interrupted.description | 206 | 141 | 146% | Ihr Gerät befindet sich möglicherweise in einem teilweise angelegten state{{startedAt}}. Führen Sie ein Audit durch, um die aktuelle Compliance zu überprüfen, oder kehren Sie zum P |
| audit-pack | extracted.text21 | 203 | 174 | 117% | Die audit pack ist ein in sich geschlossenes Dokument. Teile das PDF direkt mit den Prüfern. Downloads enthalten einen Footer mit Seitenzahlen und eine Markierung "Vertraulich – Nu |
| cis-catalog | extracted.text42 | 201 | 195 | 103% | CIS-Benchmark-Inhalte sind geistiges Eigentum des Center for Internet Security und werden separat lizenziert. ConfigForge stellt die Zuordnungslogik bereit, enthält jedoch keine CI |
| history | restore.warning | 196 | 149 | 132% | Das aktuelle Manifest wird vor der Wiederherstellung automatisch aufgenommen, sodass du zurückrollen kannst. Eine Neuregistrierung kann den gewünschten Zustand auf verwaltete Gerät |
| common | health.version-mismatch-hint | 194 | 162 | 120% | ConfigForge wurde mit {{expectedVersion}} validiert. Die installierte CLI kann während Bereitstellung oder Audit unerwartete Fehler erzeugen. Aktualisieren Sie OSConfig, wenn Probl |
| cis-catalog | extracted.text2 | 193 | 176 | 110% | Gleichen Sie Ihre OSConfig-Ressourcen mit den CIS-Benchmark-Regeln ab. Legen Sie Ihre CIS-Dateien im Ordner unten ab; der Editor zeigt passende Regeln an, während Sie durch das YAM |
| diff | errors.loadManifestsTimeout | 183 | 129 | 142% | Das Laden von Manifesten ist abgelaufen. Der Hintergrundlistenaufruf dauert länger als 10 Sekunden – versuche es mit Aktualisieren oder starte die App neu, falls es weiterhin beste |

### es: 20 longest values

| Namespace | Key | Chars | EN chars | Ratio | Value |
|---|---|---:|---:|---:|---|
| manifest-editor | deploy.enforceRiskConfirm | 424 | 328 | 129% | ADVERTENCIA: Enforcer APLICARÁ configuraciones a este dispositivo.<br><br>Esta acción puede modificar la política de seguridad de Windows o Linux de formas que puedan romper el inicio de |
| settings | systemHealth.elevation.description | 387 | 318 | 122% | La auditoría y aplicación de baselines requiere derechos de administrador para leer y escribir valores protegidos del registro, políticas CSP y configuración del sistema. Haz clic  |
| manifest-editor | actions.revertConfirm | 352 | 310 | 114% | ¿Revertir el manifiesto "{{name}}"?<br><br>Si existe una instantánea previa al despliegue, tus ajustes previos se volverán a aplicar a este dispositivo. Si no existe una instantánea, OSC |
| manifests | confirm.revert | 299 | 269 | 111% | ¿Revertir "{{name}}"?<br><br>Si existe una instantánea previa al despliegue, tus ajustes previos se volverán a aplicar a este dispositivo. Si no existe una instantánea, OSConfig aplicaci |
| dialogs | cli-required.body | 270 | 223 | 121% | <feature>{{feature}}</feature> requiere que la CLI de OSConfig esté instalada en este dispositivo. El editor, la biblioteca y las herramientas de diferencias/comparación de ConfigF |
| home | editorMode.sectionDescription | 264 | 207 | 128% | ConfigForge es totalmente utilizable para autoría, diferencias, comparación y exportación. Desplegar / Auditar / Revertir contra este dispositivo requiere OSConfig instalado localm |
| manifests | card.stats.couldNotReadTitle | 241 | 222 | 109% | Recursos que la auditoría no pudo leer (proveedor no compatible, error de transporte o ruta no compatible). No se cuentan como problemas — el dispositivo podría estar ya en el esta |
| home | firstRun.sectionDescription | 219 | 182 | 120% | ConfigForge funciona en contra de OSConfig manifiesta. Explora la biblioteca de baseline incluida (WS2019/2022/2025 roles de servidor, Defender, LAPS) para encontrar contenido list |
| compliance | perManifest.extracted.text4 | 215 | 192 | 112% | ConfigForge no redistribuye CIS contenido de Benchmark (restricciones de licencia). El informe de porcentaje de cumplimiento compara tu manifiesto con un CIS baseline, que requiere |
| manifest-editor | actions.revertTitle | 215 | 166 | 130% | Deshacer el último despliegue de este manifiesto desde este dispositivo. Si existe una instantánea previa al despliegue, se vuelven a aplicar configuraciones previas; de lo contrar |
| diff | info.oneManifest | 212 | 189 | 112% | Tienes 1 manifiesto registrado. Para comparar dos manifiestos registrados, registra primero un segundo o cambia a cualquiera de los lados al modo <strong>Pegar / Subir</strong> aba |
| cis-catalog | extracted.text42 | 211 | 195 | 108% | El contenido de CIS Benchmark es propiedad intelectual del Center for Internet Security y se licencia por separado. ConfigForge incluye la lógica de coincidencia, pero no incluye n |
| audit-pack | extracted.text21 | 209 | 174 | 120% | El audit pack es un documento independiente. Comparte el PDF directamente con los auditores. Las descargas incluyen un pie de página con números de página y una marca de "Confidenc |
| cis-catalog | extracted.text32 | 201 | 167 | 120% | (Azure Policy > Machine Configuration > CIS). Coloca el JSON tal cual. La aplicación detecta la plataforma (Windows / Linux) y hace coincidir las reglas con los recursos de tu mani |
| manifest-editor | deployResult.couldNotReadTitle | 199 | 185 | 108% | Recursos que la CLI no pudo leer (proveedor no soportado, error de transporte o ruta no soportada). Estos NO se cuentan como no cumplientes. El dispositivo puede estar realmente en |
| settings | systemHealth.install.description | 188 | 153 | 123% | El editor, la biblioteca y las características de diferencia/comparación de ConfigForge funcionan sin la CLI. Instala OSConfig para habilitar Desplegar, Auditar y Revertir en esta  |
| cis-catalog | extracted.text2 | 187 | 176 | 106% | Compara tus recursos de OSConfig con las reglas de CIS Benchmark. Coloca tus archivos CIS en la carpeta de abajo y el editor mostrará las reglas coincidentes mientras navegas por e |
| history | restore.noCurrent | 187 | 140 | 134% | No se encontró ningún manifiesto registrado actual, por lo que no se creará una instantánea automática. La restauración registrará el contenido de la instantánea como un nuevo mani |
| diff | matrix.sectionDescription | 186 | 150 | 124% | Cada fila en la matriz resultante es un ajuste; Cada columna es una baseline. Las celdas están codificadas por colores verde (idéntica), roja (diferente) o amarilla (solo en la ent |
| common | health.version-mismatch-hint | 183 | 162 | 113% | ConfigForge se validó con {{expectedVersion}}. La CLI instalada puede producir errores inesperados durante la implementación o la auditoría. Actualice OSConfig si encuentra problem |

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

