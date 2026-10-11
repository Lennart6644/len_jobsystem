Locales = {}

function L(key, ...)
    local lang = Locales[Config.Locale] or Locales.de
    local text = lang[key] or Locales.de[key] or key
    local args = { ... }
    return (text:gsub('{(%d+)}', function(n) return tostring(args[tonumber(n)]) end))
end
