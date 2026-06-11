# ConfigForge localization review

## Suggested workflow for Amir

1. Run `node scripts/review-locales.mjs --strict` after any translation edit.
2. Review high-traffic surfaces first: sidebar, common buttons, settings, home, and manifest editor toolbar.
3. Mark approved namespaces in your tracking system, not in catalog files; keep JSON values clean product text.
4. File revisions against the namespace/key shown below, then rerun this report before v0.3.61 QA polish.

## Coverage

| Locale | Translated | Fallback/TODO | Total | Coverage |
|---|---:|---:|---:|---:|
| fr | 628 | 201 | 829 | 75.8% |
| de | 582 | 247 | 829 | 70.2% |
| es | 593 | 236 | 829 | 71.5% |

## Placeholder integrity check

✅ Clean — all `{{placeholder}}` names and counts match English.

## Length analysis

Layout warnings (>150% of English): **25**

### fr: 20 longest values

| Namespace | Key | Chars | EN chars | Ratio | Value |
|---|---|---:|---:|---:|---|
| settings | systemHealth.elevation.description | 411 | 318 | 129% | L’audit et l’application des baselines nécessitent des droits administrateur pour lire et écrire les valeurs de Registre protégées, les stratégies CSP et la configuration système.  |
| manifest-editor | deploy.enforceRiskConfirm | 341 | 328 | 104% | WARNING: Enforce will APPLY paramètres to this device.<br><br>This action may change Windows or Linux security policy in ways that can break login, networking, RDP, or installé software, |
| manifest-editor | actions.revertConfirm | 328 | 310 | 106% | Revert manifeste "{{name}}"?<br><br>If a pre-déployer snapshot exists, votre prior paramètres will be re-applied to this device. If aucun snapshot exists, OSConfig enforcement of this ma |
| manifests | confirm.revert | 285 | 269 | 106% | Revert "{{name}}"?<br><br>If a pre-déployer snapshot exists, votre prior paramètres will be re-applied to this device. If aucun snapshot exists, OSConfig enforcement will be supprimerd a |
| manifests | card.stats.couldNotReadTitle | 267 | 222 | 120% | Ressources que l'audit n'a pas pu lire (fournisseur non pris en charge, erreur de transport ou chemin non pris en charge). Elles ne sont pas comptées comme des problèmes — l'appare |
| dialogs | cli-required.body | 266 | 223 | 119% | <feature>{{feature}}</feature> nécessite l’installation du CLI OSConfig sur cet appareil. L’éditeur, la bibliothèque et les outils de différence/comparaison de ConfigForge fonction |
| home | editorMode.sectionDescription | 264 | 207 | 128% | ConfigForge est entièrement utilisable pour l’édition, les différences, la comparaison et l’export. Déployer / Auditer / Rétablir sur cet appareil nécessite OSConfig installé local |
| home | firstRun.sectionDescription | 216 | 182 | 119% | ConfigForge fonctionne avec les manifestes OSConfig. Parcourez la bibliothèque de baselines intégrée (rôles serveur WS2019/2022/2025, Defender, LAPS) pour du contenu prêt à l’emplo |
| common | health.version-mismatch-hint | 198 | 162 | 122% | ConfigForge a été validé avec {{expectedVersion}}. Le CLI installé peut produire des erreurs inattendues pendant le déploiement ou l’audit. Mettez OSConfig à niveau si vous rencont |
| compliance | perManifest.extracted.text4 | 198 | 192 | 103% | ConfigForge does non redistribute CIS Benchmark content (license restrictions). The compliance % report comparers votre manifeste against a CIS baseline, which requires the catalog |
| cis-catalog | extracted.text42 | 195 | 195 | 100% | CIS benchmark content is the intellectual property of the Center for Internet Security and is licensed separately. ConfigForge ships the matching logic but does non include any CIS |
| diff | info.oneManifest | 194 | 189 | 103% | You have 1 manifeste registered. To comparer two registered manifestees, register a second one first, or switch either side to <strong>Paste / Charger</strong> mode below to paste  |
| cis-catalog | extracted.text2 | 189 | 176 | 107% | Cross-reference votre OSConfig ressources against CIS Benchmark rules. Drop votre CIS fichiers into the dossier below and the éditeur will afficher matching rules as vous navigate  |
| settings | systemHealth.install.description | 188 | 153 | 123% | L’éditeur, la bibliothèque et les fonctions différence/comparaison de ConfigForge fonctionnent sans le CLI. Installez OSConfig pour activer Déployer, Auditer et Rétablir sur cette  |
| manifest-editor | deployResult.couldNotReadTitle | 187 | 185 | 101% | Ressources the CLI could non read (provider non supported, transport erreur, or unsupported chemin). These are NOT counted as non-compliant. The device may réelly be in the desired |
| audit-pack | extracted.text21 | 177 | 174 | 102% | The audit pack is a self-contained document. Share the PDF directly with auditors. Téléchargers include a footer with page numbers and a “Confidential - Internal Use Only” mark. |
| home | interrupted.description | 176 | 141 | 125% | Votre appareil peut être dans un état partiellement appliqué{{startedAt}}. Exécutez un audit pour vérifier la conformité actuelle ou revenez à l’instantané d’avant déploiement. |
| manifest-editor | actions.revertTitle | 176 | 166 | 106% | Undo the last déployerment of this manifeste from this device. If a pre-déployer snapshot exists, prior paramètres are re-applied; otherwise OSConfig enforcement is supprimerd. |
| cis-catalog | extracted.text32 | 171 | 167 | 102% | (Azure Policy > Machine Configuration > CIS). Drop the JSON as-is. The app detects the plateforme (Windows / Linux) and matches rules to votre manifeste ressources by nom. |
| diff | matrix.sectionDescription | 156 | 150 | 104% | Each row in the resulting matrix is a setting; each column is a baseline. Cells are color-coded green (identical), red (différenceers), or yellow (only-in). |

### de: 20 longest values

| Namespace | Key | Chars | EN chars | Ratio | Value |
|---|---|---:|---:|---:|---|
| settings | systemHealth.elevation.description | 350 | 318 | 110% | Audit durchführening and applying baselines require Administrator rights to read and write protected registry Werts, CSP policies, and system configuration. Click below to trigger  |
| manifest-editor | deploy.enforceRiskConfirm | 345 | 328 | 105% | WARNING: Enforce will APPLY Einstellungen to this device.<br><br>This action may change Windows or Linux security policy in ways that can break login, networking, RDP, or installiert sof |
| manifest-editor | actions.revertConfirm | 331 | 310 | 107% | Revert Manifest "{{name}}"?<br><br>If a pre-bereitstellen snapshot exists, Ihre prior Einstellungen will be re-applied to this device. If keine snapshot exists, OSConfig enforcement of t |
| manifests | confirm.revert | 290 | 269 | 108% | Revert "{{name}}"?<br><br>If a pre-bereitstellen snapshot exists, Ihre prior Einstellungen will be re-applied to this device. If keine snapshot exists, OSConfig enforcement will be entfe |
| manifests | card.stats.couldNotReadTitle | 279 | 222 | 126% | Ressourcen, die das Audit nicht lesen konnte (Anbieter nicht unterstützt, Übertragungsfehler oder nicht unterstützter Pfad). Sie zählen nicht als Probleme — das Gerät ist möglicher |
| dialogs | cli-required.body | 260 | 223 | 117% | <feature>{{feature}}</feature> erfordert, dass die OSConfig CLI auf diesem Gerät installiert ist. Editor, Bibliothek und Diff-/Vergleichswerkzeuge von ConfigForge funktionieren ohn |
| home | editorMode.sectionDescription | 243 | 207 | 117% | ConfigForge is fully usable for authoring, Vergleich, vergleichen, and export. Bereitstellen / Audit durchführen / Revert against this device require OSConfig installiert locally.  |
| compliance | perManifest.extracted.text4 | 199 | 192 | 104% | ConfigForge does nicht redistribute CIS Benchmark content (license restrictions). The compliance % report vergleichens Ihre Manifest against a CIS baseline, which requires the cata |
| cis-catalog | extracted.text42 | 197 | 195 | 101% | CIS benchmark content is the intellectual property of the Center for Internet Security and is licensed separately. ConfigForge ships the matching logic but does nicht include any C |
| diff | info.oneManifest | 196 | 189 | 104% | You have 1 Manifest registered. To vergleichen two registered Manifeste, register a second one first, or switch either side to <strong>Paste / Hochladen</strong> mode below to past |
| manifest-editor | deployResult.couldNotReadTitle | 196 | 185 | 106% | ResQuellen the CLI could nicht read (provider nicht supported, transport Fehler, or unsupported Pfad). These are NOT counted as non-compliant. The device may tatsächlichly be in th |
| common | health.version-mismatch-hint | 194 | 162 | 120% | ConfigForge wurde mit {{expectedVersion}} validiert. Die installierte CLI kann während Bereitstellung oder Audit unerwartete Fehler erzeugen. Aktualisieren Sie OSConfig, wenn Probl |
| home | firstRun.sectionDescription | 190 | 182 | 104% | ConfigForge works against OSConfig Manifeste. Durchsuchen the bundled baseline Bibliothek (WS2019/2022/2025 server roles, Defender, LAPS) for ready-to-use content, or register Ihre |
| manifest-editor | actions.revertTitle | 188 | 166 | 113% | Undo the last bereitstellenment of this Manifest from this device. If a pre-bereitstellen snapshot exists, prior Einstellungen are re-applied; otherwise OSConfig enforcement is ent |
| settings | systemHealth.install.description | 184 | 153 | 120% | ConfigForge's Editor, Bibliothek, and Vergleich/vergleichen features work without the CLI. Install OSConfig to enable Bereitstellen, Audit durchführen, and Revert against this mach |
| cis-catalog | extracted.text2 | 182 | 176 | 103% | Cross-reference Ihre OSConfig ResQuellen against CIS Benchmark rules. Drop Ihre CIS Dateis into the Ordner below and the Editor will anzeigen matching rules as Sie navigate the YAM |
| audit-pack | extracted.text21 | 179 | 174 | 103% | The audit pack is a self-contained document. Share the PDF directly with auditors. Herunterladens include a footer with page numbers and a “Confidential - Internal Use Only” mark. |
| cis-catalog | extracted.text32 | 169 | 167 | 101% | (Azure Policy > Machine Configuration > CIS). Drop the JSON as-is. The app detects the Plattform (Windows / Linux) and matches rules to Ihre Manifest ResQuellen by Name. |
| history | restore.warning | 156 | 149 | 105% | The aktuell Manifest will be auto-snapshotted vorher restore so Sie can roll back. Re-registering may re-bereitstellen the desired state to managed devices. |
| diff | matrix.sectionDescription | 155 | 150 | 103% | Each row in the resulting matrix is a setting; each column is a baseline. Cells are color-coded green (identical), red (Vergleichers), or yellow (only-in). |

### es: 20 longest values

| Namespace | Key | Chars | EN chars | Ratio | Value |
|---|---|---:|---:|---:|---|
| settings | systemHealth.elevation.description | 344 | 318 | 108% | Auditaring and applying baselines require administrador rights to read and write protected registry valors, CSP policies, and system configuration. Click below to trigger the OS el |
| manifest-editor | deploy.enforceRiskConfirm | 338 | 328 | 103% | WARNING: Enforce will APPLY configuración to this device.<br><br>This action may change Windows or Linux security policy in ways that can break login, networking, RDP, or instalado softw |
| manifest-editor | actions.revertConfirm | 328 | 310 | 106% | Revert manifiesto "{{name}}"?<br><br>If a pre-implementar snapshot exists, su prior configuración will be re-applied to this device. If sin snapshot exists, OSConfig enforcement of this  |
| manifests | confirm.revert | 283 | 269 | 105% | Revert "{{name}}"?<br><br>If a pre-implementar snapshot exists, su prior configuración will be re-applied to this device. If sin snapshot exists, OSConfig enforcement will be quitard and |
| dialogs | cli-required.body | 270 | 223 | 121% | <feature>{{feature}}</feature> requiere que la CLI de OSConfig esté instalada en este dispositivo. El editor, la biblioteca y las herramientas de diferencias/comparación de ConfigF |
| manifests | card.stats.couldNotReadTitle | 241 | 222 | 109% | Recursos que la auditoría no pudo leer (proveedor no compatible, error de transporte o ruta no compatible). No se cuentan como problemas — el dispositivo podría estar ya en el esta |
| home | editorMode.sectionDescription | 233 | 207 | 113% | ConfigForge is fully usable for authoring, diferencias, comparar, and export. Implementar / Auditar / Revert against this device require OSConfig instalado locally. Install it any  |
| compliance | perManifest.extracted.text4 | 195 | 192 | 102% | ConfigForge does no redistribute CIS Benchmark content (license restrictions). The compliance % report comparars su manifiesto against a CIS baseline, which requires the catalog ar |
| cis-catalog | extracted.text42 | 194 | 195 | 99% | CIS benchmark content is the intellectual property of the Center for Internet Security and is licensed separately. ConfigForge ships the matching logic but does no include any CIS- |
| diff | info.oneManifest | 194 | 189 | 103% | You have 1 manifiesto registered. To comparar two registered manifiestos, register a second one first, or switch either side to <strong>Paste / Cargar</strong> mode below to paste  |
| home | firstRun.sectionDescription | 187 | 182 | 103% | ConfigForge works against OSConfig manifiestos. Examinar the bundled baseline biblioteca (WS2019/2022/2025 server roles, Defender, LAPS) for ready-to-use content, or register su ow |
| common | health.version-mismatch-hint | 183 | 162 | 113% | ConfigForge se validó con {{expectedVersion}}. La CLI instalada puede producir errores inesperados durante la implementación o la auditoría. Actualice OSConfig si encuentra problem |
| manifest-editor | actions.revertTitle | 183 | 166 | 110% | Undo the last implementarment of this manifiesto from this device. If a pre-implementar snapshot exists, prior configuración are re-applied; otherwise OSConfig enforcement is quita |
| cis-catalog | extracted.text2 | 180 | 176 | 102% | Cross-reference su OSConfig recursos against CIS Benchmark rules. Drop su CIS archivos into the carpeta below and the editor will mostrar matching rules as usted navigate the YAML. |
| manifest-editor | deployResult.couldNotReadTitle | 180 | 185 | 97% | Recursos the CLI could no read (provider no supported, transport error, or unsupported ruta). These are NOT counted as non-compliant. The device may really be in the desired state. |
| audit-pack | extracted.text21 | 175 | 174 | 101% | The audit pack is a self-contained document. Share the PDF directly with auditors. Descargars include a footer with page numbers and a “Confidential - Internal Use Only” mark. |
| settings | systemHealth.install.description | 171 | 153 | 112% | ConfigForge's editor, biblioteca, and diferencias/comparar features work without the CLI. Install OSConfig to enable Implementar, Auditar, and Revert against this machine. |
| cis-catalog | extracted.text32 | 170 | 167 | 102% | (Azure Policy > Machine Configuration > CIS). Drop the JSON as-is. The app detects the plataforma (Windows / Linux) and matches rules to su manifiesto recursos by nombre. |
| diff | matrix.sectionDescription | 157 | 150 | 105% | Each row in the resulting matrix is a setting; each column is a baseline. Cells are color-coded green (identical), red (diferenciasers), or yellow (only-in). |
| history | restore.warning | 154 | 149 | 103% | The real manifiesto will be auto-snapshotted antes restore so usted can roll back. Re-registering may re-implementar the desired state to managed devices. |

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

