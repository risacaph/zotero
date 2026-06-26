general-sentence-separator = { " " }
general-key-control = Control
general-key-shift = Shift
general-key-alt = Alt
general-key-option = Option
general-key-command = Command
option-or-alt =
    { PLATFORM() ->
        [macos] { general-key-option }
       *[other] { general-key-alt }
    }
command-or-control =
    { PLATFORM() ->
        [macos] { general-key-command }
       *[other] { general-key-control }
    }
return-or-enter =
    { PLATFORM() ->
        [macos] Return
       *[other] Enter
    }
delete-or-backspace =
    { PLATFORM() ->
        [macos] Delete
       *[other] Backspace
    }
general-print = Распечатать
general-remove = Удалить
general-add = Добавить
general-remind-me-later = Напомнить позже
general-dont-ask-again = Не спрашивать больше
general-choose-file = Выберите файл…
general-open-settings = Открыть настройки
general-settings = Настройки…
general-help = Справка
general-tag = Тег
general-got-it = Получено
general-done = Завершено
general-view-troubleshooting-instructions = Показать инструкции по отладке
general-go-back = Вернуться
general-accept = Принять
general-cancel = Отменить
general-show-in-library = Показать в библиотеке
general-restartApp = Перезапустить { -app-name }
general-restartInTroubleshootingMode = Перезапустить в режиме отладки
general-save = Сохранить:
general-clear = Очистить
general-update = Обновить
general-back = Назад
general-edit = Редактировать
general-cut = Вырезать
general-copy = Копировать
general-paste = Вставить
general-find = Найти
general-delete = Удалить
general-insert = Вставить
general-and = и
general-et-al = и др.
general-previous = Предыдущий
general-next = Следующий
general-learn-more = Узнать больше
general-more-information = Дополнительные сведения
general-warning = Внимание
general-type-to-continue = Введите “{ $text }”, чтобы продолжить.
general-continue = Продолжить
general-red = Красный
general-orange = Оранжевый
general-yellow = Жёлтый
general-green = Зелёный
general-teal = Бирюзовый
general-blue = Синий
general-purple = Пурпурный
general-magenta = Фуксин
general-violet = Фиолетовый
general-maroon = Тёмно-бордовый
general-gray = Серый
general-black = Чёрный
general-loading = Загрузка...
citation-style-label = Стиль цитирования:
language-label = Язык:
menu-custom-group-submenu =
    .label = More Options…
menu-file-show-in-finder =
    .label = Показать в файловом менеджере
menu-file-show-file =
    .label = Показать файл
menu-file-show-files =
    .label = Показать файлы
menu-print =
    .label = { general-print }
menu-density =
    .label = Плотность интерфейса
add-attachment = Добавить вложение
new-note = Новая заметка
menu-add-by-identifier =
    .label = Добавить по идентификатору…
menu-add-attachment =
    .label = { add-attachment }
menu-add-standalone-file-attachment =
    .label = Добавить файл…
menu-add-standalone-linked-file-attachment =
    .label = Добавить ссылку на файл…
menu-add-child-file-attachment =
    .label = Присоединить файл…
menu-add-child-linked-file-attachment =
    .label = Добавить ссылку на файл…
menu-add-child-linked-url-attachment =
    .label = Добавить web-ссылку…
menu-new-note =
    .label = { new-note }
menu-new-standalone-note =
    .label = Новая отдельная заметка
menu-new-item-note =
    .label = Новая заметка к записи
menu-restoreToLibrary =
    .label = Восстановить в библиотеке
menu-deletePermanently =
    .label = Удалить навсегда…
menu-tools-plugins =
    .label = Плагины
menu-view-columns-move-left =
    .label = Переместить колонку влево
menu-view-columns-move-right =
    .label = Переместить колонку вправо
menu-view-hide-context-annotation-rows =
    .label = Скрыть неподходящие аннотации
menu-view-note-font-size =
    .label = Размер шрифта заметок
menu-view-note-tab-font-size =
    .label = Размер шрифта вкладки Заметка
menu-show-tabs-menu =
    .label = Показать меню вкладок
menu-edit-copy-annotation =
    .label =
        { $count ->
            [one] Скопировать аннотацию
            [few] Скопировать { $count } аннотации
            [many] Скопировать { $count } аннотаций
           *[other] Скопировать { $count } аннотации
        }
main-window-command =
    .label = Библиотека
main-window-key =
    .key = L
trellis-toolbar-tabs-menu =
    .tooltiptext = Список всех вкладок
filter-collections = Фильтровать коллекции
trellis-collections-search =
    .placeholder = { filter-collections }
trellis-collections-search-btn =
    .tooltiptext = { filter-collections }
trellis-tabs-menu-filter =
    .placeholder = Найти вкладки
trellis-tabs-menu-close-button =
    .title = Закрыть вкладку
trellis-toolbar-tabs-scroll-forwards =
    .title = Прокрутить вперёд
trellis-toolbar-tabs-scroll-backwards =
    .title = Прокрутить назад
toolbar-add-attachment =
    .tooltiptext = { add-attachment }
recently-read = Недавно прочитано
collections-menu-show-recently-read =
    .label = Показать { recently-read }
item-menu-remove-from-recently-read =
    .label = Удалить из { recently-read }…
collections-menu-rename-collection =
    .label = Переименовать коллекцию
collections-menu-edit-saved-search =
    .label = Редактировать сохранённый поиск
collections-menu-move-collection =
    .label = Переместить в
collections-menu-copy-collection =
    .label = Копировать в
item-creator-moveDown =
    .label = Переместить вниз
item-creator-moveToTop =
    .label = Переместить в начало
item-creator-moveUp =
    .label = Переместить вверх
item-menu-viewAttachment =
    .label =
        Открыть { $numAttachments ->
            [one]
                { $attachmentType ->
                    [pdf] PDF
                    [epub] EPUB
                    [snapshot] Снапшот
                    [note] Заметка
                   *[other] Вложение
                }
           *[other]
                { $attachmentType ->
                    [pdf] PDF
                    [epub] EPUB
                    [snapshot] Снапшоты
                    [note] Заметки
                   *[other] Вложения
                }
        } { $openIn ->
            [tab] в новой вкладке
            [window] в новом окне
           *[other] { "" }
        }
item-menu-add-file =
    .label = Файл
item-menu-add-linked-file =
    .label = Связанные файлы
item-menu-add-url =
    .label = Web-ссылка
item-menu-change-parent-item =
    .label = Изменить родительскую запись…
item-menu-relate-items =
    .label = Связать элементы
view-online = Просмотреть онлайн
item-menu-option-view-online =
    .label = { view-online }
item-button-view-online =
    .tooltiptext = { view-online }
file-renaming-file-renamed-to = Файл переименован в { $filename }
itembox-button-options =
    .tooltiptext = Открыть контекстное меню
itembox-button-merge =
    .aria-label = Выберите версию поля { $field }
create-parent-intro = Введите DOI, ISBN, PMID, arXiv ID, или ADS Bibcode для идентификации этого файла:
reader-use-dark-mode-for-content =
    .label = Использовать Тёмную тему для содержимого
update-updates-found-intro-minor = Обновление для { -app-name } доступно:
update-updates-found-desc = Рекомендуется применить обновление как можно скорее.
import-window =
    .title = Импорт
import-where-from = Откуда вы хотите импортировать?
import-online-intro-title = Введение
import-source-file =
    .label = Файл (BibTeX, RIS, Trellis RDF, etc.)
import-source-folder =
    .label = Каталог файлов PDF и прочих
import-source-online =
    .label = { $targetApp } онлайн импорт
import-options = Настройки
import-importing = Идёт импортирование…
import-create-collection =
    .label = Поместить импортированные коллекции и записи в новую коллекцию
import-recreate-structure =
    .label = Воссоздать структуру папок коллекциями
import-fileTypes-header = Типы файлов для импорта:
import-fileTypes-pdf =
    .label = PDF-файлы
import-fileTypes-other =
    .placeholder = Остальные файлы по шаблону, через запятую (напр. *.jpg,*.png)
import-file-handling = Обработка файлов
import-file-handling-store =
    .label = Скопировать файлы в папку { -app-name }
import-file-handling-link =
    .label = Ссылка на файлы в исходном расположении
import-fileHandling-description = Связанные файлы не могут быть синхронизированы с помощью { -app-name }.
import-online-new =
    .label = Загрузить только новые записи; не обновлять ранее импортированные записи
import-mendeley-username = Имя пользователя
import-mendeley-password = Пароль
general-error = Ошибка
file-interface-import-error = Произошла ошибка во время импорта выбранного файла. Убедитесь что файл валиден и попробуйте ещё раз.
file-interface-import-complete = Импорт завершён
file-interface-items-were-imported =
    { $numItems ->
        [0] Файлы не были импортированы
        [one] Импортирован один файл
       *[other] { $numItems } файлов было импортировано
    }
file-interface-items-were-relinked =
    { $numRelinked ->
        [0] Ни один элемент не был повторно связан
        [one] Один элемент был повторно связан
       *[other] { $numRelinked } элементов были повторно связаны
    }
import-mendeley-encrypted = Выбранную базу данных Mendeley невозможно прочитать, вероятно она зашифрована. См. раздел <a data-l10n-name="mendeley-import-kb">Как импортировать библиотеку Mendeley в Trellis?</a> для подробностей.
file-interface-import-error-translator = Произошла ошибка при импорте выбранного файла с помощью “{ $translator }”. Убедитесь, что файл валиден, и повторите попытку.
import-online-intro = На следующем шаге вам будет предложено войти в { $targetAppOnline } и предоставить доступ { -app-name }. Это необходимо для импорта вашей библиотеки { $targetApp } в { -app-name }.
import-online-intro2 = { -app-name } никогда не увидит и не сохранит ваш { $targetApp } пароль.
import-online-form-intro = Пожалуйста, введите свои учётные данные для входа в { $targetAppOnline }. Это необходимо для импорта вашей библиотеки { $targetApp } в { -app-name }.
import-online-wrong-credentials = Не удалось войти в { $targetApp }. Пожалуйста, введите учётные данные ещё раз и повторите попытку.
import-online-blocked-by-plugin = Импорт не может быть продолжен, если установлен { $plugin }. Пожалуйста, отключите этот плагин и повторите попытку.
import-online-relink-only =
    .label = Заменить ссылки на цитирования из Mendeley Desktop
import-online-relink-kb = { general-more-information }
import-online-connection-error = { -app-name } не смог подсоединиться к { $targetApp }. Пожалуйста, проверьте своё подключение к интернету и попробуйте снова.
items-table-cell-notes =
    .aria-label =
        { $count ->
            [one] { $count } заметка
            [few] { $count } заметки
            [many] { $count } заметок
           *[other] { $count } заметок
        }
items-column-added-by = Добавлено
items-column-modified-by = Изменено
items-column-last-read = Последнее прочитанное
report-error =
    .label = Сообщить об ошибке…
rtfScan-wizard =
    .title = Поиск ссылок в RTF-документе
rtfScan-introPage-description = { -app-name } может автоизвлекать и переформатировать цитаты, а также вставлять библиографию в файлы RTF. Сейчас поддерживаются цитаты в следующих форматах:
rtfScan-introPage-description2 = Чтобы начать, выберите ниже входной файл RTF и выходной файл:
rtfScan-input-file = Входной файл:
rtfScan-output-file = Выходной файл:
rtfScan-no-file-selected = Файл не выбран
rtfScan-choose-input-file =
    .label = { general-choose-file }
    .aria-label = Выберите входной файл
rtfScan-choose-output-file =
    .label = { general-choose-file }
    .aria-label = Выберите выходной файл
rtfScan-intro-page = Введение
rtfScan-scan-page = Сканирование на наличие цитат
rtfScan-scanPage-description = { -app-name } сканирует цитирования в документе. Пожалуйста подождите.
rtfScan-citations-page = Проверить цитированные записи
rtfScan-citations-page-description = Просмотрите список распознанных цитат ниже, чтобы убедиться, что { -app-name } правильно выбрал соответствующие элементы. Любые несопоставленные или двусмысленные цитаты должны быть устранены, до перехода к следующему шагу.
rtfScan-style-page = Форматирование документа
rtfScan-format-page = Форматирование цитат
rtfScan-format-page-description = { -app-name } обрабатывает и форматирует ваш RTF-файл. Пожалуйста, будьте терпеливы.
rtfScan-complete-page = Сканирование RTF завершено
rtfScan-complete-page-description = Ваш документ был сканирован и обработан. Пожалуйста, проверьте корректность форматирования.
rtfScan-action-find-match =
    .title = Выберите подходящий элемент
rtfScan-action-accept-match =
    .title = Принять это совпадение
runJS-title = Запустить JavaScript
runJS-editor-label = Code:
runJS-run = Запустить
runJS-help = { general-help }
runJS-completed = завершено успешно
runJS-result =
    { $type ->
        [async] Return value:
       *[other] Result:
    }
runJS-run-async = Запустить как async функцию
bibliography-window =
    .title = { -app-name } - Создать Цитату/Библиографию
bibliography-style-label = { citation-style-label }
bibliography-locale-label = { language-label }
bibliography-displayAs-label = Отображать цитаты как:
bibliography-advancedOptions-label = Расширенные настройки
bibliography-outputMode-label = Режим вывода:
bibliography-outputMode-citations =
    .label =
        { $type ->
            [citation] Citations
            [note] Notes
           *[other] Citations
        }
bibliography-outputMode-bibliography =
    .label = Библиография
bibliography-outputMethod-label = Метод вывода:
bibliography-outputMethod-saveAsRTF =
    .label = Сохранить как RTF
bibliography-outputMethod-saveAsHTML =
    .label = Сохранить как HTML
bibliography-outputMethod-copyToClipboard =
    .label = Скопировать в буфер обмена
bibliography-outputMethod-print =
    .label = Распечатать
bibliography-manageStyles-label = Управление стилями…
styleEditor-locatorType =
    .aria-label = Тип локатора
styleEditor-locatorInput = Вход локатора
styleEditor-citationStyle = { citation-style-label }
styleEditor-locale = { language-label }
styleEditor-editor =
    .aria-label = Редактор стилей
styleEditor-preview =
    .aria-label = Предпросмотр
publications-intro-page = Мои публикации
publications-intro = Записи, добавленные в раздел Мои публикации, будут показаны на странице вашего профиля в trellis.org. Если вы присоединили файлы, они будут доступны публично под указанной вами лицензией. Добавляйте только ваши собственные работы и размещайте только те файлы, для которых у вас есть разрешение на распространение.
publications-include-checkbox-files =
    .label = Включая файлы
publications-include-checkbox-notes =
    .label = Включая заметки
publications-include-adjust-at-any-time = Вы можете настроить отображение в любой момент из коллекции Мои публикации.
publications-intro-authorship =
    .label = Я автор этой работы.
publications-intro-authorship-files =
    .label = Я автор этой работы и владею правами на распространение вложений.
publications-sharing-page = Выберите, как ваша работа будет распространяться
publications-sharing-keep-rights-field =
    .label = Сохранить существующее поле «Права»
publications-sharing-keep-rights-field-where-available =
    .label = Сохранить существующее поле «Права», если оно доступно.
publications-sharing-text = Вы можете защитить все права на свою работу, лицензировав её по лицензии «Creative Commons» или передать её в общественное достояние. В любом случае, работа будет опубликована на сайте trellis.org.
publications-sharing-prompt = Вы хотите разрешить распространение работы третьими лицами?
publications-sharing-reserved =
    .label = Нет, опубликовать только на trellis.org
publications-sharing-cc =
    .label = Да, под лицензией «Creative Commons»
publications-sharing-cc0 =
    .label = Да, и разрешить свободное обращение
publications-license-page = Выбрать лицензию «Creative Commons»
publications-choose-license-text = Лицензия «Creative Commons» разрешает третьей стороне копирование и распространение производных работ при указании ссылки на первоисточник, ссылки на лицензию и внесённых изменений. Дополнительные условия могут быть указаны ниже.
publications-choose-license-adaptations-prompt = Разрешить распространение производных работ?
publications-choose-license-yes =
    .label = Да
    .accesskey = Y
publications-choose-license-no =
    .label = Нет
    .accesskey = N
publications-choose-license-sharealike =
    .label = Да, если третья сторона не ограничивает распространение
    .accesskey = S
publications-choose-license-commercial-prompt = Разрешить коммерческое использование вашей работы?
publications-buttons-add-to-my-publications =
    .label = Добавить в Мои публикации
publications-buttons-next-sharing =
    .label = Далее: Распространение
publications-buttons-next-choose-license =
    .label = Выбрать лицензию
licenses-cc-0 = CC0 1.0 Universal Public Domain Dedication
licenses-cc-by = международная лицензия Creative Commons Attribution 4.0
licenses-cc-by-nd = международная лицензия Creative Commons Attribution-NoDerivatives 4.0
licenses-cc-by-sa = международная лицензия Creative Commons Attribution-ShareAlike 4.0
licenses-cc-by-nc = международная лицензия Creative Commons Attribution-NonCommercial 4.0
licenses-cc-by-nc-nd = международная лицензия Creative Commons Attribution-NonCommercial-NoDerivatives 4.0
licenses-cc-by-nc-sa = международная лицензия Creative Commons Attribution-NonCommercial-ShareAlike 4.0
licenses-cc-more-info = До размещения своей работы под лицензией Creative Commons, обязательно ознакомьтесь с рекомендациями <a data-l10n-name="license-considerations">Creative Commons для лицензиаров</a>. Применяемую вами лицензию нельзя будет отозвать, даже если вы позже выберете другие условия или прекратите публикацию произведения.
licenses-cc0-more-info = Прежде чем применять Creative Commons в своей работе, обязательно прочтите <a data-l10n-name="license-considerations">FAQ по Creative Commons</a> CC0. Обратите внимание, что передача вашей работы в общественное достояние является необратимой, даже если позже вы выберете другие условия или прекратите публикацию работы.
debug-output-logging-restart-in-troubleshooting-mode-checkbox = { general-restartInTroubleshootingMode }
restart-in-troubleshooting-mode-menuitem =
    .label = Перезапустить в режиме отладки…
    .accesskey = T
restart-in-troubleshooting-mode-dialog-title = { general-restartInTroubleshootingMode }
restart-in-troubleshooting-mode-dialog-description = { -app-name } перезагрузится со всеми отключенными плагинами. Некоторые функции могут работать некорректно, если включен Режим устранения неполадок.
menu-ui-density =
    .label = Плотность интерфейса
menu-ui-density-comfortable =
    .label = Комфортная
menu-ui-density-compact =
    .label = Компактная
pane-item-details = Детали элемента
pane-info = Информация
pane-abstract = Аннотация
pane-attachments = Вложения
pane-notes = Заметки
pane-note-info = Информация Заметки
pane-libraries-collections = Библиотеки и коллекции
pane-tags = Теги
pane-related = Связанные
pane-attachment-info = Информация Вложения
pane-attachment-preview = Предпросмотр
pane-attachment-annotations = Аннотации
pane-header-attachment-associated =
    .label = Переименовать связанный файл
item-details-pane =
    .aria-label = { pane-item-details }
section-info =
    .label = { pane-info }
section-abstract =
    .label = { pane-abstract }
section-attachments =
    .label =
        { $count ->
            [one] { $count } Вложение
            [few] { $count } Вложения
            [many] { $count } Вложений
           *[other] { $count } Вложений
        }
section-attachment-preview =
    .label = { pane-attachment-preview }
section-attachments-annotations =
    .label =
        { $count ->
            [one] { $count } Аннотация
            [few] { $count } Аннотации
            [many] { $count } Аннотаций
           *[other] { $count } Аннотаций
        }
section-attachments-move-to-trash-message = Вы уверены, что хотите переместить “{ $title }” в корзину?
section-notes =
    .label =
        { $count ->
            [one] { $count } Заметка
            [few] { $count } Заметки
            [many] { $count } Заметок
           *[other] { $count } Заметок
        }
section-libraries-collections =
    .label = { pane-libraries-collections }
section-tags =
    .label =
        { $count ->
            [one] { $count } Тег
            [few] { $count } Тега
            [many] { $count } Тегов
           *[other] { $count } Тегов
        }
section-related =
    .label = { $count } Относящихся
section-attachment-info =
    .label = { pane-attachment-info }
section-button-remove =
    .tooltiptext = { general-remove }
section-button-add =
    .tooltiptext = { general-add }
section-button-expand =
    .dynamic-tooltiptext = Развернуть секцию
    .label = Развернуть { $section } секцию
section-button-collapse =
    .dynamic-tooltiptext = Свернуть секцию
    .label = Свернуть { $section } секцию
annotations-count =
    { $count ->
        [one] { $count } аннотация
        [few] { $count } аннотации
        [many] { $count } аннотаций
       *[other] { $count } аннотаций
    }
section-button-annotations =
    .title = { annotations-count }
    .aria-label = { annotations-count }
attachment-preview =
    .aria-label = { pane-attachment-preview }
sidenav-info =
    .tooltiptext = { pane-info }
sidenav-abstract =
    .tooltiptext = { pane-abstract }
sidenav-attachments =
    .tooltiptext = { pane-attachments }
sidenav-notes =
    .tooltiptext = { pane-notes }
sidenav-note-info =
    .tooltiptext = { pane-note-info }
sidenav-attachment-info =
    .tooltiptext = { pane-attachment-info }
sidenav-attachment-preview =
    .tooltiptext = { pane-attachment-preview }
sidenav-attachment-annotations =
    .tooltiptext = { pane-attachment-annotations }
sidenav-libraries-collections =
    .tooltiptext = { pane-libraries-collections }
sidenav-tags =
    .tooltiptext = { pane-tags }
sidenav-related =
    .tooltiptext = { pane-related }
sidenav-main-btn-grouping =
    .aria-label = { pane-item-details }
sidenav-reorder-up =
    .label = Переместить блок вверх
sidenav-reorder-down =
    .label = Переместить блок вниз
sidenav-reorder-reset =
    .label = Сбросить порядок блоков
toggle-item-pane =
    .tooltiptext = Переключить панель записи
toggle-context-pane =
    .tooltiptext = Переключить контекстную панель
pin-section =
    .label = Закрепить блок
unpin-section =
    .label = Открепить блок
collapse-other-sections =
    .label = Свернуть другие блоки
expand-all-sections =
    .label = Развернуть все блоки
abstract-field =
    .placeholder = Добавить аннотацию…
tag-field =
    .aria-label = { general-tag }
tagselector-search =
    .placeholder = Фитровать теги
context-notes-search =
    .placeholder = Искать заметки
context-notes-return-button =
    .aria-label = { general-go-back }
new-collection = Новая коллекция…
menu-new-collection =
    .label = { new-collection }
toolbar-new-collection =
    .tooltiptext = { new-collection }
new-collection-dialog =
    .title = Новая коллекция
    .buttonlabelaccept = Создать коллекцию
new-collection-name = Название:
new-collection-create-in = Создать в:
show-publications-menuitem =
    .label = Показать Мои публикации
attachment-info-title = Название
attachment-info-filename = Имя файла
attachment-info-accessed = Дата доступа
attachment-info-pages = Страницы
attachment-info-modified = Изменено
attachment-info-index = Проиндексировано
attachment-info-convert-note =
    .label =
        Мигрировать { $type ->
           *[standalone] Отдельный
        } Заметка
    .tooltiptext = Добавление примечаний к вложениям больше не поддерживается, но вы можете редактировать эту заметку, перенеся её в отдельную заметку.
section-note-info =
    .label = { pane-note-info }
note-info-title = Название
note-info-parent-item = Родительская запись
note-info-parent-item-button =
    { $hasParentItem ->
        [true] { $parentItemTitle }
       *[false] None
    }
    .title =
        { $hasParentItem ->
            [true] Показать родительскую запись в библиотеке
           *[false] Показать запись заметки в библиотеке
        }
note-info-date-created = Создана
note-info-date-modified = Изменена
note-info-size = Размер
note-info-word-count = Количество слов
note-info-character-count = Количество символов
item-title-empty-note = Заметка без названия
attachment-preview-placeholder = Нет вложений для предпросмотра
attachment-rename-from-parent =
    .tooltiptext = Переименовать файл в соответствии с родительской записью
account-log-in = Войти
account-not-logged-in-text = Войдите в свой аккаунт Trellis для синхронизации данных.
account-error-login-session-expired = Время вашей сессии входа закончилось. Пожалуйста, попробуйте ещё раз.
toggle-preview =
    .label =
        { $type ->
            [open] Hide
            [collapsed] Show
           *[unknown] Toggle
        } Предпросмотр Вложения
annotation-image-not-available = [Image not available]
quicksearch-mode =
    .aria-label = Режим быстрого поиска
quicksearch-input =
    .aria-label = Быстрый поиск
    .placeholder = { $placeholder }
    .aria-description = { $placeholder }
item-pane-header-view-as =
    .label = Показать как
item-pane-header-none =
    .label = Нет
item-pane-header-title =
    .label = Название
item-pane-header-titleCreatorYear =
    .label = Название, Автор, Год
item-pane-header-bibEntry =
    .label = Библиографическая запись
item-pane-header-more-options =
    .label = Больше опций
item-pane-message-items-selected =
    { $count ->
        [0] Не выбрана ни одна запись
        [one] { $count } запись выбрана
       *[other] { $count } записей выбрано
    }
item-pane-message-collections-selected =
    { $count ->
        [one] { $count } коллекция выбрана
        [few] { $count } коллекции выбрано
        [many] { $count } коллекций выбрано
       *[other] { $count } коллекций выбрано
    }
item-pane-message-searches-selected =
    { $count ->
        [one] { $count } поиск выбран
        [few] { $count } поиска выбрано
        [many] { $count } поисков выбрано
       *[other] { $count } поиска выбрано
    }
item-pane-message-objects-selected =
    { $count ->
        [one] { $count } объект выбран
        [few] { $count } объекта выбрано
        [many] { $count } объектов выбрано
       *[other] { $count } объекта выбрано
    }
item-pane-message-unselected =
    { $count ->
        [0] Нет записей в этом представлении нет записей
        [one] { $count } запись в этом представлении
        [few] { $count } записей в этом представлении
        [many] { $count } записей в этом представлении
       *[other] { $count } записей в этом представлении
    }
item-pane-message-objects-unselected =
    { $count ->
        [0] Нет объектов в этом представлении
        [one] { $count } объект в этом представлении
        [few] { $count } объекта в этом представлении
        [many] { $count } объектов в этом представлении
       *[other] { $count } объекта в этом представлении
    }
item-pane-duplicates-merge-items =
    .label =
        { $count ->
            [one] Объединить { $count } запись
            [few] Объединить { $count } элемента
            [many] Объединить { $count } записей
           *[other] Объединить { $count } записей
        }
locate-library-lookup-no-resolver = Вы должны выбрать резолвер из { $pane } панели { -app-name } настроек.
architecture-win32-warning-message = Переключитесь на 64-bit { -app-name } для лучшей производительности. Данные не будут затронуты.
architecture-warning-action = Скачать 64-bit { -app-name }
architecture-x64-on-arm64-message = { -app-name } работает в режиме эмуляции. Нативная версия { -app-name } будет работать эффективнее.
architecture-x64-on-arm64-action = Скачать { -app-name } для ARM64
first-run-guidance-authorMenu = { -app-name } позволяет также указать редакторов и переводчиков. Вы можете превратить автора в редактора или переводчика, выбрав это меню.
first-run-guidance-readAloud = { -app-name } теперь может читать ваши документы с естественным звучанием голоса.
advanced-search-remove-btn =
    .tooltiptext = { general-remove }
advanced-search-add-btn =
    .tooltiptext = { general-add }
advanced-search-conditions-menu =
    .aria-label = Условия поиска
    .label = { $label }
advanced-search-operators-menu =
    .aria-label = Оператор
    .label = { $label }
advanced-search-condition-input =
    .aria-label = Значение
    .label = { $label }
search-conditions-tooltip-fields = Поля:
search-conditions-collection = Коллекция
search-conditions-savedSearch = Сохранённый поиск
search-conditions-itemTypeID = Тип записи
search-conditions-tag = Тег
search-conditions-note = Заметка
search-conditions-childNote = Дочерняя заметка
search-conditions-creator = Автор
search-conditions-thesisType = Тип диссертации
search-conditions-reportType = Тип отчёта
search-conditions-videoRecordingFormat = Формат видеозаписи
search-conditions-audioFileType = Тип аудио файла
search-conditions-audioRecordingFormat = Формат аудиозаписи
search-conditions-letterType = Тип письма
search-conditions-interviewMedium = Носитель интервью
search-conditions-manuscriptType = Тип рукописи
search-conditions-presentationType = Тип презентации
search-conditions-mapType = Тип карты
search-conditions-artworkMedium = Художественный носитель
search-conditions-dateModified = Дата изменения
search-conditions-fulltextContent = Содержание Вложения
search-conditions-programmingLanguage = Язык программирования
search-conditions-fileTypeID = Тип Вложения
search-conditions-lastRead = Вложение Последнее прочитанное
search-conditions-annotationText = Текст аннотации
search-conditions-annotationComment = Комментарий к аннотации
search-conditions-anyField = Любое поле
find-pdf-files-added =
    { $count ->
        [one] Добавлен { $count } файл
        [few] Добавлено { $count } файла
        [many] Добавлено { $count } файлов
       *[other] Добавлено { $count } файла
    }
select-items-window =
    .title = Выбрать записи
select-items-dialog =
    .buttonlabelaccept = Выбрать
select-items-convertToStandalone =
    .label = Конвертировать в Отдельное
select-items-convertToStandaloneAttachment =
    .label =
        { $count ->
            [one] Преобразовать в Отдельное Вложение
            [few] Преобразовать в отдельные вложения
            [many] Преобразовать в Отдельные Вложения
           *[other] Преобразовать в Отдельные Вложения
        }
select-items-convertToStandaloneNote =
    .label =
        { $count ->
            [one] Преобразовать в Отдельную Заметку
            [few] Преобразовать в Отдельные Заметки
            [many] Преобразовать в Отдельные Заметки
           *[other] Преобразовать в Отдельные Заметки
        }
file-type-webpage = Веб-страница
file-type-image = Изображение
file-type-pdf = PDF
file-type-audio = Аудио
file-type-video = Видео
file-type-presentation = Презентация
file-type-document = Документ
file-type-ebook = Электронная книга
post-upgrade-message = Вы проапгрейдились до <span data-l10n-name="post-upgrade-appver">{ -app-name } { $version }</span>! Узнайте <a data-l10n-name="new-features-link">что нового</a>.
post-upgrade-remind-me-later =
    .label = { general-remind-me-later }
post-upgrade-done =
    .label = { general-done }
text-action-paste-and-search =
    .label = Вставить и Искать
mac-word-plugin-install-message = Trellis необходим доступ к данным Word для установки плагина для Word.
mac-word-plugin-install-action-button =
    .label = Установить плагин для Word
mac-word-plugin-install-remind-later-button =
    .label = { general-remind-me-later }
mac-word-plugin-install-dont-ask-again-button =
    .label = { general-dont-ask-again }
file-renaming-banner-message = { -app-name } теперь автосинхронизирует имена файлов вложений при внесении изменений в элементы.
file-renaming-banner-documentation-link = { general-learn-more }
file-renaming-banner-settings-link = { general-settings }
connector-version-warning = { -app-name } коннектор должен быть обновлён для работы с этой версией { -app-name }.
userjs-pref-warning = Некоторые настройки { -app-name } были переопределены с помощью неподдерживаемого метода. { -app-name } отменяет их и перезапускает.
migrate-extra-fields-progress-message = Перенос новых полей из Extra field
long-tag-fixer-window-title =
    .title = Разделить теги
long-tag-fixer-button-dont-split =
    .label = Не разделять
menu-normalize-attachment-titles =
    .label = Нормализовать названия вложений…
normalize-attachment-titles-title = Нормализовать названия вложений
normalize-attachment-titles-text =
    { -app-name } автоматически переименовывает файлы на диске, используя метаданные родительской записи, но использует отдельные, более простые названия, такие как “Полный текст PDF”, “Препринт PDF”, или “PDF” для первичных вложений, для поддержания визуальной чистоты списка записей и избежания повторения информации.
    
    В более старых версиях { -app-name }, а также при использовании определённых плагинов, названия вложений могут быть изменены без необходимости в соответствии с именами файлов.
    
    Хотите сделать названия выбранных вложений более простыми? Только первичные вложения с названиями, которые совпадают с именами файлов, будут изменены.
banner-close-button =
    .aria-label = Скрыть уведомление
plugins-blocked-plugin =
    .message = Этот плагин был отключён { -app-name }.
data-dir-unsupported-storage = This can happen if the { -app-name } data directory is in a cloud storage folder (OneDrive, Dropbox, etc.) or on a network share.
