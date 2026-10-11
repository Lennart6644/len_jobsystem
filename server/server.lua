

local ESX = nil
local MySQL = exports.oxmysql

CreateThread(function()
    MySQL:execute('ALTER TABLE `jobs` ADD COLUMN IF NOT EXISTS `description` TEXT NULL DEFAULT NULL', {}, function() end)
    MySQL:execute('ALTER TABLE `jobs` ADD COLUMN IF NOT EXISTS `applications_open` TINYINT(1) NOT NULL DEFAULT 0', {}, function() end)
    MySQL:execute('ALTER TABLE `jobs` ADD COLUMN IF NOT EXISTS `application_text` TEXT NULL DEFAULT NULL', {}, function() end)

    MySQL:execute([[
        CREATE TABLE IF NOT EXISTS `job_applications` (
            `id` INT NOT NULL AUTO_INCREMENT,
            `job_name` VARCHAR(50) NOT NULL,
            `identifier` VARCHAR(60) NOT NULL,
            `applicant_name` VARCHAR(100) NOT NULL,
            `subject` VARCHAR(150) NOT NULL,
            `body` TEXT NOT NULL,
            `greeting` VARCHAR(150) NOT NULL,
            `status` VARCHAR(20) NOT NULL DEFAULT 'open',
            `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (`id`),
            KEY `idx_job_name` (`job_name`),
            KEY `idx_identifier` (`identifier`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ]], {}, function() end)

    MySQL:execute([[
        CREATE TABLE IF NOT EXISTS `job_application_messages` (
            `id` INT NOT NULL AUTO_INCREMENT,
            `application_id` INT NOT NULL,
            `sender` VARCHAR(20) NOT NULL,
            `sender_name` VARCHAR(100) NOT NULL,
            `message` TEXT NOT NULL,
            `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (`id`),
            KEY `idx_application_id` (`application_id`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ]], {}, function() end)
end)

local function IsAdmin(xPlayer)
    if not xPlayer then return false end
    local group = xPlayer.getGroup and xPlayer.getGroup() or nil
    if not group then return false end
    for _, g in ipairs(Config.AdminGroups) do
        if g == group then return true end
    end
    return false
end

local function DbBool(v)
    if type(v) == 'boolean' then return v end
    if type(v) == 'number' then return v == 1 end
    if type(v) == 'string' then return v == '1' or v:lower() == 'true' end
    return false
end

local function NormalizeDbDate(v)
    if type(v) ~= 'number' then return v end
    local seconds = v
    if v > 100000000000 then
        seconds = math.floor(v / 1000)
    end
    return os.date('!%Y-%m-%d %H:%M:%S', seconds)
end

local function NormalizeApplicationRow(app)
    if not app then return app end
    app.created_at = NormalizeDbDate(app.created_at)
    app.updated_at = NormalizeDbDate(app.updated_at)
    return app
end

local function NormalizeApplicationRows(rows)
    for _, row in ipairs(rows or {}) do
        NormalizeApplicationRow(row)
    end
    return rows
end

local function NormalizeMessageRows(rows)
    for _, row in ipairs(rows or {}) do
        row.created_at = NormalizeDbDate(row.created_at)
    end
    return rows
end

local function IsHireableJob(jobName)
    if not jobName then return false end
    for _, j in ipairs(Config.HireableFromJobs) do
        if j == jobName then return true end
    end
    return false
end

local function IsJobManager(xPlayer)
    if not xPlayer then return false end
    local jobName = xPlayer.job.name
    local managerGrade = Config.JobManagerGrades[jobName]
    if not managerGrade then return false end
    return tonumber(xPlayer.job.grade) >= tonumber(managerGrade)
end

local function TruncateStr(str, maxLen)
    if not str then return '' end
    str = tostring(str)
    if #str > maxLen then return str:sub(1, maxLen) end
    return str
end

local VALID_APPLICATION_STATUSES = {
    open = true, accepted = true, declined = true, declined_final = true,
}

local function GetAllXPlayers()
    local list = {}
    if ESX.GetExtendedPlayers then
        list = ESX.GetExtendedPlayers()
    else
        for _, playerId in ipairs(ESX.GetPlayers()) do
            local xPlayer = ESX.GetPlayerFromId(playerId)
            if xPlayer then table.insert(list, xPlayer) end
        end
    end
    return list
end

function LogAction(xPlayer, message)
    local text = string.format('[JobSystem] %s (%s): %s', xPlayer.getName(), xPlayer.identifier, message)
    print(text)

    if Config.Webhook then
        PerformHttpRequest(Config.Webhook, function() end, 'POST', json.encode({
            username = L('webhook_username'),
            embeds = {{
                title = L('webhook_title'),
                description = message,
                color = 3900150,
                fields = {
                    { name = 'Admin', value = xPlayer.getName(), inline = true },
                    { name = 'Identifier', value = xPlayer.identifier, inline = true },
                },
                timestamp = os.date('!%Y-%m-%dT%H:%M:%SZ')
            }}
        }), { ['Content-Type'] = 'application/json' })
    end
end

function RefreshESXJobs()
    if not ESX then return end

    if ESX.RefreshJobs then
        ESX.RefreshJobs()
        return
    end

    if not ESX.Jobs then return end

    MySQL:fetch('SELECT * FROM jobs', {}, function(jobs)
        if not jobs then return end
        for _, job in ipairs(jobs) do
            MySQL:fetch('SELECT * FROM job_grades WHERE job_name = ?', { job.name }, function(grades)
                local jobGrades = {}
                for _, grade in ipairs(grades or {}) do
                    local okM, skinMale   = pcall(json.decode, grade.skin_male ~= '' and grade.skin_male or '{}')
                    local okF, skinFemale = pcall(json.decode, grade.skin_female ~= '' and grade.skin_female or '{}')
                    jobGrades[tostring(grade.grade)] = {
                        grade       = grade.grade,
                        name        = grade.name,
                        label       = grade.label,
                        salary      = grade.salary,
                        skin_male   = okM and skinMale or {},
                        skin_female = okF and skinFemale or {},
                    }
                end
                ESX.Jobs[job.name] = {
                    name        = job.name,
                    label       = job.label,
                    whitelisted = DbBool(job.whitelisted),
                    grades      = jobGrades,
                }
            end)
        end
    end)
end

local function GetSortedGrades(jobName, cb)
    MySQL:fetch('SELECT * FROM job_grades WHERE job_name = ? ORDER BY grade ASC', { jobName }, function(rows)
        cb(rows or {})
    end)
end

local function GetCurrentCharacterJob(xTarget, identifier, cb)
    if xTarget then
        cb(xTarget.job.name, xTarget.job.grade)
        return
    end
    MySQL:fetch('SELECT job, job_grade FROM users WHERE identifier = ?', { identifier }, function(rows)
        if rows and rows[1] then
            cb(rows[1].job, rows[1].job_grade)
        else
            cb(nil, nil)
        end
    end)
end

local function ApplyCharacterJob(xTarget, identifier, jobName, grade, xPlayer, actionLabel, cb)
    if xTarget then
        xTarget.setJob(jobName, grade)
        LogAction(xPlayer, ('%s: %s (%s) -> %s Grade %s'):format(actionLabel, xTarget.getName(), identifier, jobName, tostring(grade)))
        cb(true)
    else
        MySQL:update('UPDATE users SET job = ?, job_grade = ? WHERE identifier = ?', { jobName, grade, identifier }, function(affected)
            if not affected or affected == 0 then
                cb(false, L('err_character_not_found'))
                return
            end
            LogAction(xPlayer, ('%s (offline): %s -> %s Grade %s'):format(actionLabel, identifier, jobName, tostring(grade)))
            cb(true)
        end)
    end
end

AddEventHandler('esx:setJob', function(playerId, job, lastJob)
    if not job or not lastJob then return end
    if job.name == lastJob.name and job.grade == lastJob.grade then return end

    TriggerClientEvent('jobsystem:notifyJobChange', playerId, {
        oldJobLabel   = lastJob.label or lastJob.name,
        oldGradeLabel = lastJob.grade_label,
        newJobLabel   = job.label or job.name,
        newGradeLabel = job.grade_label,
    })
end)

CreateThread(function()
    while ESX == nil do
        TriggerEvent('esx:getSharedObject', function(obj) ESX = obj end)
        Wait(0)
    end

    ESX.RegisterServerCallback('jobsystem:getJobs', function(source, cb)
        MySQL:fetch('SELECT * FROM jobs ORDER BY label ASC', {}, function(jobs)
            jobs = jobs or {}

            MySQL:fetch('SELECT job_name, COUNT(*) as gradeCount FROM job_grades GROUP BY job_name', {}, function(gradeCounts)
                local gcMap = {}
                for _, row in ipairs(gradeCounts or {}) do
                    gcMap[row.job_name] = row.gradeCount
                end

                MySQL:fetch('SELECT name FROM addon_account WHERE name LIKE "society\\_%"', {}, function(accounts)
                    local societySet = {}
                    for _, acc in ipairs(accounts or {}) do
                        local jobName = string.gsub(acc.name, '^society_', '')
                        societySet[jobName] = true
                    end

                    local onlineMap = {}
                    for _, xPlayer in ipairs(GetAllXPlayers()) do
                        local jn = xPlayer.job.name
                        onlineMap[jn] = (onlineMap[jn] or 0) + 1
                    end

                    for _, job in ipairs(jobs) do
                        job.whitelisted      = DbBool(job.whitelisted)
                        job.gradeCount       = gcMap[job.name] or 0
                        job.onlineCount      = onlineMap[job.name] or 0
                        job.hasSociety       = societySet[job.name] or false
                        job.applicationsOpen = DbBool(job.applications_open)
                    end

                    cb(jobs)
                end)
            end)
        end)
    end)

    ESX.RegisterServerCallback('jobsystem:getJobDetails', function(source, cb, jobName)
        MySQL:fetch('SELECT * FROM jobs WHERE name = ?', { jobName }, function(jobResult)
            if not jobResult or #jobResult == 0 then
                cb(nil)
                return
            end

            local job = jobResult[1]
            job.whitelisted      = DbBool(job.whitelisted)
            job.applicationsOpen = DbBool(job.applications_open)
            job.applicationText  = job.application_text or ''

            MySQL:fetch('SELECT * FROM job_grades WHERE job_name = ? ORDER BY grade ASC', { jobName }, function(grades)
                job.grades = grades or {}

                local accountName = 'society_' .. jobName
                MySQL:fetch('SELECT * FROM addon_account WHERE name = ?', { accountName }, function(accResult)
                    if accResult and #accResult > 0 then
                        local account = accResult[1]
                        MySQL:fetch('SELECT * FROM addon_account_data WHERE account_name = ? LIMIT 1', { accountName }, function(dataResult)
                            account.money  = (dataResult and dataResult[1] and dataResult[1].money) or 0
                            account.exists = true
                            account.shared = DbBool(account.shared)
                            job.society = account
                            cb(job)
                        end)
                    else
                        job.society = {
                            name    = accountName,
                            label   = job.label .. L('society_suffix'),
                            shared  = 1,
                            money   = 0,
                            exists  = false,
                        }
                        cb(job)
                    end
                end)
            end)
        end)
    end)

    ESX.RegisterServerCallback('jobsystem:saveJob', function(source, cb, data)
        local xPlayer = ESX.GetPlayerFromId(source)
        if not IsAdmin(xPlayer) then cb(false, L('err_no_permission')) return end

        if not data or not data.name or data.name == '' or not data.label or data.label == '' then
            cb(false, L('err_job_name_label_empty'))
            return
        end

        local name = string.lower(string.gsub(data.name, '%s+', '_'))
        local params = {
            label       = data.label,
            whitelisted = data.whitelisted and 1 or 0,
            description = data.description or '',
        }

        MySQL:scalar('SELECT COUNT(*) FROM jobs WHERE name = ?', { name }, function(count)
            if count and count > 0 then
                MySQL:update('UPDATE jobs SET label = ?, whitelisted = ?, description = ? WHERE name = ?', {
                    params.label, params.whitelisted, params.description, name
                }, function()
                    RefreshESXJobs()
                    LogAction(xPlayer, L('log_job_updated', name))
                    cb(true)
                end)
            else
                MySQL:insert('INSERT INTO jobs (name, label, whitelisted, description) VALUES (?,?,?,?)', {
                    name, params.label, params.whitelisted, params.description
                }, function()
                    RefreshESXJobs()
                    LogAction(xPlayer, L('log_job_created', name))
                    cb(true, name)
                end)
            end
        end)
    end)

    ESX.RegisterServerCallback('jobsystem:createOfflineJob', function(source, cb, data)
        local xPlayer = ESX.GetPlayerFromId(source)
        if not IsAdmin(xPlayer) then cb(false, L('err_no_permission')) return end

        if not data or not data.jobName or data.jobName == '' then
            cb(false, L('err_no_job_selected'))
            return
        end

        local baseJobName = data.jobName
        if baseJobName:sub(1, 3) == 'off' then
            cb(false, L('err_offline_of_offline'))
            return
        end

        MySQL:fetch('SELECT * FROM jobs WHERE name = ?', { baseJobName }, function(jobResult)
            if not jobResult or #jobResult == 0 then
                cb(false, L('err_source_job_not_found'))
                return
            end

            local baseJob = jobResult[1]
            local offJobName  = 'off' .. baseJobName
            local offJobLabel = 'Off-' .. baseJob.label
            local description = baseJob.description or ''

            MySQL:scalar('SELECT COUNT(*) FROM jobs WHERE name = ?', { offJobName }, function(count)
                local function afterJobUpserted()
                    MySQL:fetch('SELECT * FROM job_grades WHERE job_name = ? ORDER BY grade ASC', { baseJobName }, function(baseGrades)
                        baseGrades = baseGrades or {}
                        if #baseGrades == 0 then
                            RefreshESXJobs()
                            LogAction(xPlayer, L('log_offjob_no_grades', offJobName, baseJobName))
                            cb(true, offJobName)
                            return
                        end

                        MySQL:fetch('SELECT id, grade FROM job_grades WHERE job_name = ?', { offJobName }, function(existingOffGrades)
                            local existingByGrade = {}
                            for _, g in ipairs(existingOffGrades or {}) do
                                existingByGrade[tonumber(g.grade)] = g.id
                            end

                            local function upsertGrade(i)
                                if i > #baseGrades then
                                    RefreshESXJobs()
                                    LogAction(xPlayer, L('log_offjob_upserted', offJobName, baseJobName, #baseGrades))
                                    cb(true, offJobName)
                                    return
                                end

                                local bg = baseGrades[i]
                                local existingId = existingByGrade[tonumber(bg.grade)]

                                if existingId then
                                    MySQL:update('UPDATE job_grades SET name=?, label=?, salary=?, skin_male=?, skin_female=? WHERE id=?', {
                                        bg.name, 'Off-Duty', 750, bg.skin_male or '{}', bg.skin_female or '{}', existingId
                                    }, function()
                                        upsertGrade(i + 1)
                                    end)
                                else
                                    MySQL:scalar('SELECT COALESCE(MAX(id),0)+1 FROM job_grades', {}, function(newId)
                                        MySQL:insert('INSERT INTO job_grades (id, job_name, grade, name, label, salary, skin_male, skin_female) VALUES (?,?,?,?,?,?,?,?)', {
                                            newId, offJobName, bg.grade, bg.name, 'Off-Duty', 750, bg.skin_male or '{}', bg.skin_female or '{}'
                                        }, function()
                                            upsertGrade(i + 1)
                                        end)
                                    end)
                                end
                            end

                            upsertGrade(1)
                        end)
                    end)
                end

                if count and count > 0 then
                    MySQL:update('UPDATE jobs SET label = ?, whitelisted = ?, description = ? WHERE name = ?', {
                        offJobLabel, baseJob.whitelisted, description, offJobName
                    }, afterJobUpserted)
                else
                    MySQL:insert('INSERT INTO jobs (name, label, whitelisted, description) VALUES (?,?,?,?)', {
                        offJobName, offJobLabel, baseJob.whitelisted, description
                    }, afterJobUpserted)
                end
            end)
        end)
    end)

    ESX.RegisterServerCallback('jobsystem:deleteJob', function(source, cb, jobName)
        local xPlayer = ESX.GetPlayerFromId(source)
        if not IsAdmin(xPlayer) then cb(false, L('err_no_permission')) return end

        if jobName == Config.UnemployedJob then
            cb(false, L('err_unemployed_delete'))
            return
        end

        for _, xTarget in ipairs(GetAllXPlayers()) do
            if xTarget.job.name == jobName then
                xTarget.setJob(Config.UnemployedJob, Config.UnemployedGrade)
            end
        end

        MySQL:execute('DELETE FROM job_grades WHERE job_name = ?', { jobName }, function()
            MySQL:execute('DELETE FROM jobs WHERE name = ?', { jobName }, function()
                local accountName = 'society_' .. jobName
                MySQL:execute('DELETE FROM addon_account_data WHERE account_name = ?', { accountName }, function() end)
                MySQL:execute('DELETE FROM addon_account WHERE name = ?', { accountName }, function() end)
                RefreshESXJobs()
                LogAction(xPlayer, L('log_job_deleted', jobName))
                cb(true)
            end)
        end)
    end)

    ESX.RegisterServerCallback('jobsystem:saveGrade', function(source, cb, data)
        local xPlayer = ESX.GetPlayerFromId(source)
        if not IsAdmin(xPlayer) then cb(false, L('err_no_permission')) return end

        if not data or not data.job_name or not data.name or not data.label or data.grade == nil or data.salary == nil then
            cb(false, L('err_required_fields'))
            return
        end

        local skinMale   = (data.skin_male ~= nil and data.skin_male ~= '') and data.skin_male or '{}'
        local skinFemale = (data.skin_female ~= nil and data.skin_female ~= '') and data.skin_female or '{}'

        local okM = pcall(json.decode, skinMale)
        local okF = pcall(json.decode, skinFemale)
        if not okM or not okF then
            cb(false, L('err_skin_json'))
            return
        end

        if data.id then
            MySQL:update('UPDATE job_grades SET grade=?, name=?, label=?, salary=?, skin_male=?, skin_female=? WHERE id=?', {
                data.grade, data.name, data.label, data.salary, skinMale, skinFemale, data.id
            }, function()
                RefreshESXJobs()
                LogAction(xPlayer, L('log_grade_updated', data.job_name, tostring(data.grade)))
                cb(true)
            end)
        else
            MySQL:scalar('SELECT COALESCE(MAX(id),0)+1 FROM job_grades', {}, function(newId)
                MySQL:insert('INSERT INTO job_grades (id, job_name, grade, name, label, salary, skin_male, skin_female) VALUES (?,?,?,?,?,?,?,?)', {
                    newId, data.job_name, data.grade, data.name, data.label, data.salary, skinMale, skinFemale
                }, function()
                    RefreshESXJobs()
                    LogAction(xPlayer, L('log_grade_created', data.job_name, tostring(data.grade)))
                    cb(true)
                end)
            end)
        end
    end)

    ESX.RegisterServerCallback('jobsystem:reorderGrades', function(source, cb, data)
        local xPlayer = ESX.GetPlayerFromId(source)
        if not IsAdmin(xPlayer) then cb(false, L('err_no_permission')) return end

        if not data or not data.job_name or type(data.order) ~= 'table' or #data.order == 0 then
            cb(false, L('err_invalid_order'))
            return
        end

        local jobName = data.job_name

        MySQL:fetch('SELECT id, grade FROM job_grades WHERE job_name = ?', { jobName }, function(rows)
            rows = rows or {}
            if #rows == 0 then
                cb(false, L('err_job_no_grades'))
                return
            end

            local oldGradeById = {}
            for _, row in ipairs(rows) do
                oldGradeById[tostring(row.id)] = tonumber(row.grade)
            end

            local order, seen = {}, {}
            for _, id in ipairs(data.order) do
                local key = tostring(id)
                if oldGradeById[key] ~= nil and not seen[key] then
                    seen[key] = true
                    table.insert(order, id)
                end
            end

            if #order ~= #rows then
                cb(false, L('err_order_mismatch'))
                return
            end

            local oldToNew, updates = {}, {}
            for i, id in ipairs(order) do
                local newGrade = i - 1
                updates[i] = { id = id, grade = newGrade }
                oldToNew[oldGradeById[tostring(id)]] = newGrade
            end

            local phase1, phase2, finish

            phase1 = function(i)
                if i > #updates then phase2(1) return end
                MySQL:execute('UPDATE job_grades SET grade = ? WHERE id = ?', { -(1000 + i), updates[i].id }, function()
                    phase1(i + 1)
                end)
            end

            phase2 = function(i)
                if i > #updates then finish() return end
                MySQL:execute('UPDATE job_grades SET grade = ? WHERE id = ?', { updates[i].grade, updates[i].id }, function()
                    phase2(i + 1)
                end)
            end

            finish = function()

                local caseParts, params = {}, {}
                for oldGrade, newGrade in pairs(oldToNew) do
                    table.insert(caseParts, 'WHEN ? THEN ?')
                    table.insert(params, oldGrade)
                    table.insert(params, newGrade)
                end
                table.insert(params, jobName)

                local sql = ('UPDATE users SET job_grade = CASE job_grade %s ELSE job_grade END WHERE job = ?')
                    :format(table.concat(caseParts, ' '))

                MySQL:execute(sql, params, function()
                    RefreshESXJobs()

                    for _, xTarget in ipairs(GetAllXPlayers()) do
                        if xTarget.job.name == jobName then
                            local newGrade = oldToNew[tonumber(xTarget.job.grade)]
                            if newGrade ~= nil and newGrade ~= tonumber(xTarget.job.grade) then
                                xTarget.setJob(jobName, newGrade)
                            end
                        end
                    end

                    LogAction(xPlayer, L('log_grade_order', jobName))
                    cb(true)
                end)
            end

            phase1(1)
        end)
    end)

    ESX.RegisterServerCallback('jobsystem:deleteGrade', function(source, cb, gradeId)
        local xPlayer = ESX.GetPlayerFromId(source)
        if not IsAdmin(xPlayer) then cb(false, L('err_no_permission')) return end

        MySQL:execute('DELETE FROM job_grades WHERE id = ?', { gradeId }, function()
            RefreshESXJobs()
            LogAction(xPlayer, L('log_grade_deleted', tostring(gradeId)))
            cb(true)
        end)
    end)

    ESX.RegisterServerCallback('jobsystem:saveSociety', function(source, cb, data)
        local xPlayer = ESX.GetPlayerFromId(source)
        if not IsAdmin(xPlayer) then cb(false, L('err_no_permission')) return end

        if not data or not data.name then cb(false, L('err_invalid_data')) return end

        local accountName = data.name
        local label        = data.label or accountName
        local shared        = data.shared and 1 or 0

        local function upsertData()
            MySQL:scalar('SELECT COUNT(*) FROM addon_account_data WHERE account_name = ?', { accountName }, function(dataCount)
                if dataCount and dataCount > 0 then
                    if data.moneyAction == 'set' then
                        MySQL:update('UPDATE addon_account_data SET money = ? WHERE account_name = ?', { data.amount or 0, accountName }, function()
                            LogAction(xPlayer, L('log_society_set', accountName, tostring(data.amount)))
                            cb(true)
                        end)
                    elseif data.moneyAction == 'add' then
                        MySQL:update('UPDATE addon_account_data SET money = money + ? WHERE account_name = ?', { data.amount or 0, accountName }, function()
                            LogAction(xPlayer, L('log_society_add', tostring(data.amount), accountName))
                            cb(true)
                        end)
                    elseif data.moneyAction == 'remove' then
                        MySQL:update('UPDATE addon_account_data SET money = GREATEST(0, money - ?) WHERE account_name = ?', { data.amount or 0, accountName }, function()
                            LogAction(xPlayer, L('log_society_remove', tostring(data.amount), accountName))
                            cb(true)
                        end)
                    else
                        cb(true)
                    end
                else
                    MySQL:scalar('SELECT COALESCE(MAX(id),0)+1 FROM addon_account_data', {}, function(newId)
                        MySQL:insert('INSERT INTO addon_account_data (id, account_name, money, owner) VALUES (?,?,?,NULL)', {
                            newId, accountName, data.amount or 0
                        }, function()
                            cb(true)
                        end)
                    end)
                end
            end)
        end

        MySQL:scalar('SELECT COUNT(*) FROM addon_account WHERE name = ?', { accountName }, function(count)
            if count and count > 0 then
                MySQL:update('UPDATE addon_account SET label = ?, shared = ? WHERE name = ?', { label, shared, accountName }, function()
                    upsertData()
                end)
            else
                MySQL:insert('INSERT INTO addon_account (name, label, shared) VALUES (?,?,?)', { accountName, label, shared }, function()
                    upsertData()
                end)
            end
        end)
    end)

    ESX.RegisterServerCallback('jobsystem:saveAdminApplicationSettings', function(source, cb, data)
        local xPlayer = ESX.GetPlayerFromId(source)
        if not IsAdmin(xPlayer) then cb(false, L('err_no_permission')) return end

        local jobName = data and data.jobName
        if not jobName or jobName == '' then cb(false, L('err_invalid_job')) return end

        local applicationsOpen = (data and data.applicationsOpen) and 1 or 0
        local applicationText  = TruncateStr(data and data.applicationText or '', 2000)

        MySQL:update('UPDATE jobs SET applications_open = ?, application_text = ? WHERE name = ?', {
            applicationsOpen, applicationText, jobName
        }, function(affected)
            if not affected or affected == 0 then
                cb(false, L('err_job_not_found'))
                return
            end
            LogAction(xPlayer, L('log_app_phase_admin', jobName, applicationsOpen == 1 and L('status_open_upper') or L('status_closed_upper')))
            cb(true)
        end)
    end)

    ESX.RegisterServerCallback('jobsystem:getAdminJobApplications', function(source, cb, jobName)
        local xPlayer = ESX.GetPlayerFromId(source)
        if not IsAdmin(xPlayer) then cb({}) return end
        if not jobName or jobName == '' then cb({}) return end

        MySQL:fetch('SELECT * FROM job_applications WHERE job_name = ? ORDER BY updated_at DESC', { jobName }, function(rows)
            cb(NormalizeApplicationRows(rows or {}))
        end)
    end)

    ESX.RegisterServerCallback('jobsystem:getOnlinePlayers', function(source, cb, jobName)
        local list = {}
        for _, xTarget in ipairs(GetAllXPlayers()) do
            if xTarget.job.name == jobName then
                table.insert(list, {
                    source     = xTarget.source,
                    identifier = xTarget.identifier,
                    name       = GetPlayerName(xTarget.source) or (L('player_prefix') .. xTarget.source),
                    grade      = xTarget.job.grade,
                    gradeLabel = xTarget.job.grade_label or '',
                })
            end
        end
        table.sort(list, function(a, b) return a.grade > b.grade end)
        cb(list)
    end)

    ESX.RegisterServerCallback('jobsystem:setPlayerJob', function(source, cb, targetId, jobName, grade)
        local xPlayer = ESX.GetPlayerFromId(source)
        if not IsAdmin(xPlayer) then cb(false, L('err_no_permission')) return end

        local xTarget = ESX.GetPlayerFromId(tonumber(targetId))
        if not xTarget then cb(false, L('err_player_offline')) return end

        xTarget.setJob(jobName, tonumber(grade))
        LogAction(xPlayer, L('log_player_set', xTarget.getName(), xTarget.identifier, jobName, tostring(grade)))
        cb(true)
    end)

    ESX.RegisterServerCallback('jobsystem:searchCharacters', function(source, cb, query)
        local xPlayer = ESX.GetPlayerFromId(source)
        if not IsAdmin(xPlayer) then cb({}) return end

        if not query or #query < 2 then cb({}) return end

        local like = '%' .. query .. '%'
        MySQL:fetch([[
            SELECT u.identifier, u.firstname, u.lastname, u.job, u.job_grade,
                   j.label AS jobLabel, g.label AS gradeLabel
            FROM users u
            LEFT JOIN jobs j ON j.name = u.job
            LEFT JOIN job_grades g ON g.job_name = u.job AND g.grade = u.job_grade
            WHERE u.identifier LIKE ? OR CONCAT(u.firstname, ' ', u.lastname) LIKE ?
            ORDER BY u.firstname ASC
            LIMIT 25
        ]], { like, like }, function(rows)
            rows = rows or {}
            local results = {}

            for _, row in ipairs(rows) do
                local xTarget = ESX.GetPlayerFromIdentifier(row.identifier)
                local entry = {
                    identifier = row.identifier,
                    name       = (row.firstname or '') .. ' ' .. (row.lastname or ''),
                    job        = row.job,
                    jobLabel   = row.jobLabel or row.job,
                    grade      = row.job_grade,
                    gradeLabel = row.gradeLabel,
                    online     = xTarget ~= nil,
                }

                if xTarget then

                    entry.name       = xTarget.getName() or entry.name
                    entry.job        = xTarget.job.name
                    entry.jobLabel   = xTarget.job.label
                    entry.grade      = xTarget.job.grade
                    entry.gradeLabel = xTarget.job.grade_label
                end

                table.insert(results, entry)
            end

            cb(results)
        end)
    end)

    ESX.RegisterServerCallback('jobsystem:setCharacterJob', function(source, cb, data)
        local xPlayer = ESX.GetPlayerFromId(source)
        if not IsAdmin(xPlayer) then cb(false, L('err_no_permission')) return end

        if not data or not data.identifier or not data.action then
            cb(false, L('err_invalid_data'))
            return
        end

        local xTarget = ESX.GetPlayerFromIdentifier(data.identifier)

        if data.action == 'fire' then
            ApplyCharacterJob(xTarget, data.identifier, Config.UnemployedJob, Config.UnemployedGrade, xPlayer, L('lbl_char_fired'), cb)
            return
        end

        if data.action == 'assign' then
            if not data.jobName or data.jobName == '' or data.grade == nil then
                cb(false, L('err_select_job_grade'))
                return
            end
            local grade = tonumber(data.grade)
            if grade == nil then cb(false, L('err_invalid_grade')) return end

            if ESX.DoesJobExist and not ESX.DoesJobExist(data.jobName, tostring(grade)) then
                cb(false, L('err_job_grade_missing'))
                return
            end

            ApplyCharacterJob(xTarget, data.identifier, data.jobName, grade, xPlayer, L('lbl_char_hired'), cb)
            return
        end

        if data.action == 'promote' or data.action == 'demote' then
            GetCurrentCharacterJob(xTarget, data.identifier, function(curJob, curGrade)
                if not curJob then
                    cb(false, L('err_character_not_found'))
                    return
                end

                GetSortedGrades(curJob, function(grades)
                    if #grades == 0 then
                        cb(false, L('err_no_grades_defined'))
                        return
                    end

                    local idx = 1
                    for i, g in ipairs(grades) do
                        if tonumber(g.grade) == tonumber(curGrade) then
                            idx = i
                            break
                        end
                    end

                    local step = (data.action == 'promote') and 1 or -1
                    local newIdx = idx + step
                    if newIdx < 1 or newIdx > #grades then
                        cb(false, data.action == 'promote' and L('err_max_grade') or L('err_min_grade'))
                        return
                    end

                    local targetGrade = grades[newIdx]
                    local label = (data.action == 'promote') and L('lbl_char_promoted') or L('lbl_char_demoted')
                    ApplyCharacterJob(xTarget, data.identifier, curJob, tonumber(targetGrade.grade), xPlayer, label, cb)
                end)
            end)
            return
        end

        cb(false, L('err_unknown_action'))
    end)

    ESX.RegisterServerCallback('jobsystem:getMyJob', function(source, cb)
        local xPlayer = ESX.GetPlayerFromId(source)
        if not xPlayer then cb(nil) return end

        local jobName = xPlayer.job.name

        MySQL:fetch('SELECT * FROM jobs WHERE name = ?', { jobName }, function(jobResult)
            local job = jobResult and jobResult[1]
            if not job then cb(nil) return end
            job.whitelisted = DbBool(job.whitelisted)

            MySQL:fetch('SELECT * FROM job_grades WHERE job_name = ? ORDER BY grade ASC', { jobName }, function(grades)
                job.grades = grades or {}

                local managerGrade = Config.JobManagerGrades[jobName]
                local myGrade = tonumber(xPlayer.job.grade)

                job.myGrade      = myGrade
                job.myGradeLabel = xPlayer.job.grade_label
                job.mySalary     = xPlayer.job.grade_salary or 0
                job.managerGrade = managerGrade
                job.isManager    = managerGrade ~= nil and myGrade >= tonumber(managerGrade)
                job.applicationsOpen = DbBool(job.applications_open)
                job.applicationText  = job.application_text or ''

                cb(job)
            end)
        end)
    end)

    ESX.RegisterServerCallback('jobsystem:getEmployees', function(source, cb)
        local xPlayer = ESX.GetPlayerFromId(source)
        if not xPlayer then cb({}) return end

        local jobName = xPlayer.job.name
        local myGrade = tonumber(xPlayer.job.grade)
        local managerGrade = Config.JobManagerGrades[jobName]

        if not managerGrade or myGrade < tonumber(managerGrade) then
            cb({ employees = {}, grades = {}, myGrade = myGrade })
            return
        end

        MySQL:fetch('SELECT identifier, firstname, lastname, job_grade FROM users WHERE job = ? ORDER BY job_grade DESC', { jobName }, function(rows)
            rows = rows or {}

            GetSortedGrades(jobName, function(grades)
                local gradeMap = {}
                for _, g in ipairs(grades) do gradeMap[tostring(g.grade)] = g end

                local list = {}
                for _, row in ipairs(rows) do
                    local xTarget = ESX.GetPlayerFromIdentifier(row.identifier)
                    local grade = xTarget and xTarget.job.grade or row.job_grade
                    local gradeInfo = gradeMap[tostring(grade)]

                    table.insert(list, {
                        identifier = row.identifier,
                        name       = xTarget and xTarget.getName() or (((row.firstname or '') .. ' ' .. (row.lastname or '')):gsub('^%s+', ''):gsub('%s+$', '')),
                        online     = xTarget ~= nil,
                        grade      = tonumber(grade),
                        gradeLabel = gradeInfo and gradeInfo.label or tostring(grade),
                        canManage  = tonumber(grade) < myGrade,
                    })
                end

                table.sort(list, function(a, b) return a.grade > b.grade end)

                cb({ employees = list, grades = grades, myGrade = myGrade })
            end)
        end)
    end)

    ESX.RegisterServerCallback('jobsystem:manageEmployee', function(source, cb, data)
        local xPlayer = ESX.GetPlayerFromId(source)
        if not xPlayer then cb(false, L('err_player_not_found')) return end

        local jobName = xPlayer.job.name
        local myGrade = tonumber(xPlayer.job.grade)
        local managerGrade = Config.JobManagerGrades[jobName]

        if not managerGrade or myGrade < tonumber(managerGrade) then
            cb(false, L('err_no_permission'))
            return
        end

        if not data or not data.identifier or not data.action then
            cb(false, L('err_invalid_data'))
            return
        end

        local xTarget = ESX.GetPlayerFromIdentifier(data.identifier)

        GetCurrentCharacterJob(xTarget, data.identifier, function(curJob, curGrade)
            if not curJob or curJob ~= jobName then
                cb(false, L('err_not_your_job'))
                return
            end
            curGrade = tonumber(curGrade)

            if curGrade >= myGrade then
                cb(false, L('err_cannot_manage'))
                return
            end

            if data.action == 'fire' then
                ApplyCharacterJob(xTarget, data.identifier, Config.UnemployedJob, Config.UnemployedGrade, xPlayer, L('lbl_emp_fired'), cb)
                return
            end

            if data.action == 'setGrade' then
                local newGrade = tonumber(data.grade)
                if newGrade == nil then cb(false, L('err_invalid_rank')) return end
                if newGrade >= myGrade then
                    cb(false, L('err_set_not_higher'))
                    return
                end
                ApplyCharacterJob(xTarget, data.identifier, jobName, newGrade, xPlayer, L('lbl_grade_set_by_employer'), cb)
                return
            end

            if data.action == 'promote' or data.action == 'demote' then
                GetSortedGrades(jobName, function(grades)
                    if #grades == 0 then
                        cb(false, L('err_no_grades_defined'))
                        return
                    end

                    local idx = 1
                    for i, g in ipairs(grades) do
                        if tonumber(g.grade) == curGrade then idx = i break end
                    end

                    local step = (data.action == 'promote') and 1 or -1
                    local newIdx = idx + step
                    if newIdx < 1 or newIdx > #grades then
                        cb(false, data.action == 'promote' and L('err_max_grade') or L('err_min_grade'))
                        return
                    end

                    local targetGrade = tonumber(grades[newIdx].grade)
                    if targetGrade >= myGrade then
                        cb(false, L('err_promote_not_higher'))
                        return
                    end

                    local label = (data.action == 'promote') and L('lbl_emp_promoted') or L('lbl_emp_demoted')
                    ApplyCharacterJob(xTarget, data.identifier, jobName, targetGrade, xPlayer, label, cb)
                end)
                return
            end

            cb(false, L('err_unknown_action'))
        end)
    end)

    ESX.RegisterServerCallback('jobsystem:searchHireCandidates', function(source, cb, query)
        local xPlayer = ESX.GetPlayerFromId(source)
        if not xPlayer then cb({}) return end

        local jobName = xPlayer.job.name
        local myGrade = tonumber(xPlayer.job.grade)
        local managerGrade = Config.JobManagerGrades[jobName]

        if not managerGrade or myGrade < tonumber(managerGrade) then cb({}) return end
        if not query or #query < 2 then cb({}) return end
        if #Config.HireableFromJobs == 0 then cb({}) return end

        local placeholders = {}
        for _ in ipairs(Config.HireableFromJobs) do table.insert(placeholders, '?') end

        local sql = ([[
            SELECT u.identifier, u.firstname, u.lastname, u.job, j.label AS jobLabel
            FROM users u
            LEFT JOIN jobs j ON j.name = u.job
            WHERE (u.identifier LIKE ? OR CONCAT(u.firstname, ' ', u.lastname) LIKE ?)
              AND u.job IN (%s)
            ORDER BY u.firstname ASC
            LIMIT 20
        ]]):format(table.concat(placeholders, ','))

        local like = '%' .. query .. '%'
        local params = { like, like }
        for _, j in ipairs(Config.HireableFromJobs) do table.insert(params, j) end

        MySQL:fetch(sql, params, function(rows)
            rows = rows or {}
            local results = {}
            for _, row in ipairs(rows) do
                local xTarget = ESX.GetPlayerFromIdentifier(row.identifier)
                table.insert(results, {
                    identifier = row.identifier,
                    name       = xTarget and xTarget.getName() or (((row.firstname or '') .. ' ' .. (row.lastname or '')):gsub('^%s+', ''):gsub('%s+$', '')),
                    job        = xTarget and xTarget.job.name or row.job,
                    jobLabel   = xTarget and xTarget.job.label or (row.jobLabel or row.job),
                    online     = xTarget ~= nil,
                })
            end
            cb(results)
        end)
    end)

    ESX.RegisterServerCallback('jobsystem:hireEmployee', function(source, cb, data)
        local xPlayer = ESX.GetPlayerFromId(source)
        if not xPlayer then cb(false, L('err_player_not_found')) return end

        local jobName = xPlayer.job.name
        local myGrade = tonumber(xPlayer.job.grade)
        local managerGrade = Config.JobManagerGrades[jobName]

        if not managerGrade or myGrade < tonumber(managerGrade) then
            cb(false, L('err_no_permission'))
            return
        end

        if not data or not data.identifier then
            cb(false, L('err_invalid_data'))
            return
        end

        local grade = tonumber(data.grade) or 0
        if grade >= myGrade then
            cb(false, L('err_hire_not_higher'))
            return
        end

        local xTarget = ESX.GetPlayerFromIdentifier(data.identifier)

        GetCurrentCharacterJob(xTarget, data.identifier, function(curJob)
            if not curJob then
                cb(false, L('err_player_not_found_2'))
                return
            end

            if not IsHireableJob(curJob) then
                cb(false, L('err_must_be_fired_first'))
                return
            end

            ApplyCharacterJob(xTarget, data.identifier, jobName, grade, xPlayer, L('lbl_emp_hired'), cb)
        end)
    end)

    ESX.RegisterServerCallback('jobsystem:saveJobSettings', function(source, cb, data)
        local xPlayer = ESX.GetPlayerFromId(source)
        if not IsJobManager(xPlayer) then cb(false, L('err_no_permission')) return end

        local jobName = xPlayer.job.name
        local label = (data and data.label) or ''
        label = label:gsub('^%s+', ''):gsub('%s+$', '')
        local description = (data and data.description) or ''

        if label == '' then
            cb(false, L('err_label_empty'))
            return
        end

        MySQL:update('UPDATE jobs SET label = ?, description = ? WHERE name = ?', { label, description, jobName }, function(affected)
            if not affected or affected == 0 then
                cb(false, L('err_job_not_updated'))
                return
            end
            RefreshESXJobs()
            LogAction(xPlayer, L('log_jobsettings', jobName, label))
            cb(true)
        end)
    end)

    ESX.RegisterServerCallback('jobsystem:saveApplicationSettings', function(source, cb, data)
        local xPlayer = ESX.GetPlayerFromId(source)
        if not IsJobManager(xPlayer) then cb(false, L('err_no_permission')) return end

        local jobName = xPlayer.job.name
        local applicationsOpen = (data and data.applicationsOpen) and 1 or 0
        local applicationText  = TruncateStr(data and data.applicationText or '', 2000)

        MySQL:update('UPDATE jobs SET applications_open = ?, application_text = ? WHERE name = ?', {
            applicationsOpen, applicationText, jobName
        }, function()
            LogAction(xPlayer, L('log_app_phase', jobName, applicationsOpen == 1 and L('status_open_upper') or L('status_closed_upper')))
            cb(true)
        end)
    end)

    ESX.RegisterServerCallback('jobsystem:getJobApplications', function(source, cb)
        local xPlayer = ESX.GetPlayerFromId(source)
        if not IsJobManager(xPlayer) then cb({}) return end

        MySQL:fetch('SELECT * FROM job_applications WHERE job_name = ? ORDER BY updated_at DESC', { xPlayer.job.name }, function(rows)
            cb(NormalizeApplicationRows(rows or {}))
        end)
    end)

    ESX.RegisterServerCallback('jobsystem:getApplicationThread', function(source, cb, applicationId)
        local xPlayer = ESX.GetPlayerFromId(source)
        if not xPlayer then cb(nil) return end

        MySQL:fetch('SELECT * FROM job_applications WHERE id = ?', { applicationId }, function(rows)
            local app = rows and rows[1]
            if not app then cb(nil) return end

            local isOwner = app.identifier == xPlayer.identifier
            local isManagerOfJob = (xPlayer.job.name == app.job_name and IsJobManager(xPlayer)) or IsAdmin(xPlayer)

            if not isOwner and not isManagerOfJob then
                cb(nil)
                return
            end

            MySQL:fetch('SELECT * FROM job_application_messages WHERE application_id = ? ORDER BY created_at ASC', { applicationId }, function(messages)
                app.messages  = NormalizeMessageRows(messages or {})
                app.canReply  = app.status ~= 'declined_final'

                app.isManagerView = isManagerOfJob and not isOwner
                NormalizeApplicationRow(app)
                cb(app)
            end)
        end)
    end)

    ESX.RegisterServerCallback('jobsystem:updateApplicationStatus', function(source, cb, data)
        local xPlayer = ESX.GetPlayerFromId(source)
        if not xPlayer then cb(false, L('err_player_not_found')) return end

        if not data or not data.id or not data.status or not VALID_APPLICATION_STATUSES[data.status] then
            cb(false, L('err_invalid_data'))
            return
        end

        MySQL:fetch('SELECT * FROM job_applications WHERE id = ?', { data.id }, function(rows)
            local app = rows and rows[1]
            if not app then
                cb(false, L('err_application_not_found'))
                return
            end

            if app.identifier == xPlayer.identifier then
                cb(false, L('err_own_status'))
                return
            end

            local isManagerOfJob = xPlayer.job.name == app.job_name and IsJobManager(xPlayer)
            if not isManagerOfJob and not IsAdmin(xPlayer) then
                cb(false, L('err_no_permission'))
                return
            end

            MySQL:update('UPDATE job_applications SET status = ? WHERE id = ?', { data.status, data.id }, function()
                LogAction(xPlayer, L('log_app_status', tostring(data.id), app.job_name, data.status))
                cb(true)
            end)
        end)
    end)

    ESX.RegisterServerCallback('jobsystem:sendApplicationMessage', function(source, cb, data)
        local xPlayer = ESX.GetPlayerFromId(source)
        if not xPlayer then cb(false, L('err_player_not_found')) return end

        local message = data and data.message and data.message:gsub('^%s+', ''):gsub('%s+$', '') or ''
        if message == '' then cb(false, L('err_message_empty')) return end
        message = TruncateStr(message, Config.ApplicationMessageMaxLength)

        MySQL:fetch('SELECT * FROM job_applications WHERE id = ?', { data and data.id }, function(rows)
            local app = rows and rows[1]
            if not app then cb(false, L('err_application_not_found')) return end

            local isOwner = app.identifier == xPlayer.identifier
            local isManagerOfJob = (xPlayer.job.name == app.job_name and IsJobManager(xPlayer)) or IsAdmin(xPlayer)

            if not isOwner and not isManagerOfJob then
                cb(false, L('err_no_permission'))
                return
            end

            if app.status == 'declined_final' then
                cb(false, L('err_chat_closed'))
                return
            end

            local senderType = (isManagerOfJob and not isOwner) and 'manager' or 'applicant'
            local senderName = xPlayer.getName()

            MySQL:insert('INSERT INTO job_application_messages (application_id, sender, sender_name, message) VALUES (?,?,?,?)', {
                app.id, senderType, senderName, message
            }, function()
                MySQL:update('UPDATE job_applications SET updated_at = NOW() WHERE id = ?', { app.id }, function()
                    cb(true)
                end)
            end)
        end)
    end)

    ESX.RegisterServerCallback('jobsystem:getMyName', function(source, cb)
        local xPlayer = ESX.GetPlayerFromId(source)
        cb(xPlayer and xPlayer.getName() or '')
    end)

    ESX.RegisterServerCallback('jobsystem:getOpenApplicationJobs', function(source, cb)
        local xPlayer = ESX.GetPlayerFromId(source)
        if not xPlayer then cb({}) return end

        MySQL:fetch('SELECT * FROM jobs WHERE applications_open = 1 ORDER BY label ASC', {}, function(jobs)
            jobs = jobs or {}
            local jobNames = {}
            for _, j in ipairs(jobs) do table.insert(jobNames, j.name) end

            local function finish(gradesByJob)
                for _, j in ipairs(jobs) do
                    j.grades = gradesByJob[j.name] or {}
                end
                cb(jobs)
            end

            if #jobNames == 0 then finish({}) return end

            local placeholders = {}
            for _ in ipairs(jobNames) do table.insert(placeholders, '?') end

            MySQL:fetch(('SELECT * FROM job_grades WHERE job_name IN (%s) ORDER BY grade ASC'):format(table.concat(placeholders, ',')), jobNames, function(grades)
                grades = grades or {}
                local gradesByJob = {}
                for _, g in ipairs(grades) do
                    gradesByJob[g.job_name] = gradesByJob[g.job_name] or {}
                    table.insert(gradesByJob[g.job_name], g)
                end
                finish(gradesByJob)
            end)
        end)
    end)

    ESX.RegisterServerCallback('jobsystem:submitApplication', function(source, cb, data)
        local xPlayer = ESX.GetPlayerFromId(source)
        if not xPlayer then cb(false, L('err_player_not_found')) return end

        local jobName = data and data.jobName
        local subject = data and data.subject and data.subject:gsub('^%s+', ''):gsub('%s+$', '') or ''
        local body    = data and data.body and data.body:gsub('^%s+', ''):gsub('%s+$', '') or ''

        if not jobName or jobName == '' then cb(false, L('err_invalid_job')) return end
        if subject == '' or body == '' then cb(false, L('err_subject_body_required')) return end

        subject = TruncateStr(subject, Config.ApplicationSubjectMaxLength)
        body    = TruncateStr(body, Config.ApplicationBodyMaxLength)

        MySQL:scalar('SELECT applications_open FROM jobs WHERE name = ?', { jobName }, function(applicationsOpen)
            if not DbBool(applicationsOpen) then
                cb(false, L('err_applications_closed'))
                return
            end

            MySQL:scalar([[
                SELECT COUNT(*) FROM job_applications
                WHERE job_name = ? AND identifier = ? AND status IN ('open', 'accepted')
            ]], { jobName, xPlayer.identifier }, function(count)
                if count and count > 0 then
                    cb(false, L('err_already_applied'))
                    return
                end

                local applicantName = xPlayer.getName()
                local greeting = ('%s, %s'):format(L('ui_greeting'), applicantName)

                MySQL:insert([[
                    INSERT INTO job_applications (job_name, identifier, applicant_name, subject, body, greeting, status)
                    VALUES (?,?,?,?,?,?, 'open')
                ]], { jobName, xPlayer.identifier, applicantName, subject, body, greeting }, function()
                    LogAction(xPlayer, L('log_app_submitted', jobName))
                    cb(true)
                end)
            end)
        end)
    end)

    ESX.RegisterServerCallback('jobsystem:getMyApplications', function(source, cb)
        local xPlayer = ESX.GetPlayerFromId(source)
        if not xPlayer then cb({}) return end

        MySQL:fetch([[
            SELECT a.*, j.label AS jobLabel
            FROM job_applications a
            LEFT JOIN jobs j ON j.name = a.job_name
            WHERE a.identifier = ?
            ORDER BY a.updated_at DESC
        ]], { xPlayer.identifier }, function(rows)
            cb(NormalizeApplicationRows(rows or {}))
        end)
    end)

    ESX.RegisterServerCallback('jobsystem:getJobCenterJobs', function(source, cb)
        local xPlayer = ESX.GetPlayerFromId(source)
        if not xPlayer then cb(nil) return end

        MySQL:fetch('SELECT * FROM jobs WHERE whitelisted = 0 ORDER BY label ASC', {}, function(jobs)
            jobs = jobs or {}

            local jobNames = {}
            for _, j in ipairs(jobs) do table.insert(jobNames, j.name) end

            local function finish(gradesByJob)
                for _, j in ipairs(jobs) do
                    j.whitelisted = false
                    j.grades = gradesByJob[j.name] or {}
                end

                cb({
                    myJob        = xPlayer.job.name,
                    myJobLabel   = xPlayer.job.label,
                    myGrade      = xPlayer.job.grade,
                    myGradeLabel = xPlayer.job.grade_label,
                    myHireable   = IsHireableJob(xPlayer.job.name),
                    jobs = jobs,
                })
            end

            if #jobNames == 0 then
                finish({})
                return
            end

            local placeholders = {}
            for _ in ipairs(jobNames) do table.insert(placeholders, '?') end

            MySQL:fetch(('SELECT * FROM job_grades WHERE job_name IN (%s) ORDER BY grade ASC'):format(table.concat(placeholders, ',')), jobNames, function(grades)
                grades = grades or {}
                local gradesByJob = {}
                for _, g in ipairs(grades) do
                    gradesByJob[g.job_name] = gradesByJob[g.job_name] or {}
                    table.insert(gradesByJob[g.job_name], g)
                end
                finish(gradesByJob)
            end)
        end)
    end)

    ESX.RegisterServerCallback('jobsystem:applyJobCenterJob', function(source, cb, jobName)
        local xPlayer = ESX.GetPlayerFromId(source)
        if not xPlayer then cb(false, L('err_player_not_found')) return end

        if not jobName or jobName == '' then
            cb(false, L('err_invalid_job'))
            return
        end

        if not IsHireableJob(xPlayer.job.name) then
            cb(false, L('err_must_quit_first'))
            return
        end

        MySQL:fetch('SELECT * FROM jobs WHERE name = ?', { jobName }, function(jobResult)
            local job = jobResult and jobResult[1]
            if not job then
                cb(false, L('err_job_missing'))
                return
            end
            if DbBool(job.whitelisted) then
                cb(false, L('err_job_whitelisted'))
                return
            end
            if job.name == xPlayer.job.name then
                cb(false, L('err_already_have_job'))
                return
            end

            xPlayer.setJob(jobName, 0)
            LogAction(xPlayer, L('log_jobcenter_switch', jobName))
            cb(true)
        end)
    end)
end)

RegisterCommand('job', function(source)
    if source == 0 then
        print(L('cmd_players_only'))
        return
    end
    if not ESX then return end
    TriggerClientEvent('jobsystem:openEmployerUI', source)
end, false)

RegisterCommand('jobsettings', function(source)
    if source == 0 then
        print(L('cmd_players_only'))
        return
    end

    if not ESX then return end
    local xPlayer = ESX.GetPlayerFromId(source)
    if not IsAdmin(xPlayer) then
        TriggerClientEvent('esx:showNotification', source, '~r~' .. L('cmd_no_permission'))
        return
    end

    TriggerClientEvent('jobsystem:openUI', source)
end, false)