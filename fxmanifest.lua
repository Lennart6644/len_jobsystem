fx_version 'cerulean'
game 'gta5'
lua54 'yes'

author 'Custom Development'
description 'ESX Advanced Job & Society Management System (/jobsettings)'
version '1.0.0'

dependencies {
    'es_extended',
    'oxmysql'
}

shared_scripts {
    'config.lua',
    'locales/locale.lua',
    'locales/de.lua',
    'locales/en.lua'
}

client_scripts {
    'client/client.lua'
}

server_scripts {
    'server/server.lua'
}

ui_page 'html/index.html'

files {
    'html/index.html',
    'html/style.css',
    'html/script.js'
}
