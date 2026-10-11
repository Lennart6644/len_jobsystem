

local ESX = nil
local uiOpen = false
local currentUI = nil

CreateThread(function()
    while ESX == nil do
        TriggerEvent('esx:getSharedObject', function(obj) ESX = obj end)
        Wait(0)
    end
end)

RegisterNetEvent('jobsystem:openUI', function()
    if uiOpen then return end
    uiOpen = true
    currentUI = 'jobsettings'
    SetNuiFocus(true, true)
    SendNUIMessage({ action = 'open' })
end)

RegisterNetEvent('jobsystem:openEmployerUI', function()
    if uiOpen then return end
    uiOpen = true
    currentUI = 'employer'
    SetNuiFocus(true, true)
    SendNUIMessage({ action = 'openEmployer' })
end)

RegisterNetEvent('jobsystem:openJobCenterUI', function()
    if uiOpen then return end
    uiOpen = true
    currentUI = 'jobcenter'
    SetNuiFocus(true, true)
    SendNUIMessage({ action = 'openJobCenter' })
end)

local function CloseUI()
    if not uiOpen then return end
    uiOpen = false
    currentUI = nil
    SetNuiFocus(false, false)
    SendNUIMessage({ action = 'close' })
end

CreateThread(function()
    while true do
        local sleep = 500
        if uiOpen then
            sleep = 0
            DisableControlAction(0, 1, true)
            DisableControlAction(0, 2, true)
            DisableControlAction(0, 24, true)
            DisableControlAction(0, 25, true)
            DisableControlAction(0, 106, true)
            DisableControlAction(0, 142, true)
        end
        Wait(sleep)
    end
end)

local function DrawText3D(coords, text)
    local onScreen, x, y = World3dToScreen2d(coords.x, coords.y, coords.z)
    if not onScreen then return end

    local pCoords = GetGameplayCamCoords()
    local dist = #(pCoords - coords)
    local scale = (1 / dist) * 2
    local fov = (1 / GetGameplayCamFov()) * 100
    scale = scale * fov

    SetTextScale(0.0 * scale, 0.35 * scale)
    SetTextFont(4)
    SetTextProportional(1)
    SetTextColour(255, 255, 255, 215)
    SetTextEntry('STRING')
    SetTextCentre(1)
    AddTextComponentString(text)
    DrawText(x, y)
end

CreateThread(function()
    if Config.JobCenter.blip and Config.JobCenter.blip.enabled then
        local coords = Config.JobCenter.coords
        local blip = AddBlipForCoord(coords.x, coords.y, coords.z)
        SetBlipSprite(blip, Config.JobCenter.blip.sprite)
        SetBlipColour(blip, Config.JobCenter.blip.color)
        SetBlipScale(blip, Config.JobCenter.blip.scale)
        SetBlipAsShortRange(blip, true)
        BeginTextCommandSetBlipName('STRING')
        AddTextComponentString(Config.JobCenter.blip.label or L('jc_title'))
        EndTextCommandSetBlipName(blip)
    end
end)

CreateThread(function()
    local coords = Config.JobCenter.coords
    while true do
        local sleep = 800
        local playerCoords = GetEntityCoords(PlayerPedId())
        local dist = #(playerCoords - coords)

        if dist < Config.JobCenter.drawDistance then
            sleep = 0
            local m = Config.JobCenter.marker
            DrawMarker(m.type, coords.x, coords.y, coords.z - 0.98,
                0.0, 0.0, 0.0, 0.0, 0.0, 0.0, m.size.x, m.size.y, m.size.z,
                m.color.r, m.color.g, m.color.b, m.color.a, false, true, 2, false, nil, nil, false)

            if dist < Config.JobCenter.interactionDistance then
                if not uiOpen then
                    DrawText3D(vector3(coords.x, coords.y, coords.z + 1.0), '~b~E~s~ - ' .. L('jc_open_prompt'))
                    if IsControlJustReleased(0, Config.JobCenter.interactionControl) then
                        TriggerEvent('jobsystem:openJobCenterUI')
                    end
                end
            end
        end

        Wait(sleep)
    end
end)

RegisterNetEvent('jobsystem:notifyJobChange', function(payload)
    SendNUIMessage({ action = 'jobChangeNotify', payload = payload })
end)

RegisterNUICallback('closeUI', function(_, cb)
    CloseUI()
    cb('ok')
end)

RegisterNUICallback('getJobs', function(_, cb)
    ESX.TriggerServerCallback('jobsystem:getJobs', function(result)
        cb(result or {})
    end)
end)

RegisterNUICallback('getJobDetails', function(data, cb)
    ESX.TriggerServerCallback('jobsystem:getJobDetails', function(result)
        cb(result)
    end, data.jobName)
end)

RegisterNUICallback('saveJob', function(data, cb)
    ESX.TriggerServerCallback('jobsystem:saveJob', function(success, message)
        cb({ success = success, message = message })
    end, data)
end)

RegisterNUICallback('deleteJob', function(data, cb)
    ESX.TriggerServerCallback('jobsystem:deleteJob', function(success, message)
        cb({ success = success, message = message })
    end, data.jobName)
end)

RegisterNUICallback('saveGrade', function(data, cb)
    ESX.TriggerServerCallback('jobsystem:saveGrade', function(success, message)
        cb({ success = success, message = message })
    end, data)
end)

RegisterNUICallback('deleteGrade', function(data, cb)
    ESX.TriggerServerCallback('jobsystem:deleteGrade', function(success, message)
        cb({ success = success, message = message })
    end, data.id)
end)

RegisterNUICallback('reorderGrades', function(data, cb)
    ESX.TriggerServerCallback('jobsystem:reorderGrades', function(success, message)
        cb({ success = success, message = message })
    end, data)
end)

RegisterNUICallback('createOfflineJob', function(data, cb)
    ESX.TriggerServerCallback('jobsystem:createOfflineJob', function(success, offJobName)
        cb({ success = success, offJobName = (success and offJobName or nil), message = (not success and offJobName or nil) })
    end, data)
end)

RegisterNUICallback('saveSociety', function(data, cb)
    ESX.TriggerServerCallback('jobsystem:saveSociety', function(success, message)
        cb({ success = success, message = message })
    end, data)
end)

RegisterNUICallback('getOnlinePlayers', function(data, cb)
    ESX.TriggerServerCallback('jobsystem:getOnlinePlayers', function(result)
        cb(result or {})
    end, data.jobName)
end)

RegisterNUICallback('setPlayerJob', function(data, cb)
    ESX.TriggerServerCallback('jobsystem:setPlayerJob', function(success, message)
        cb({ success = success, message = message })
    end, data.targetId, data.jobName, data.grade)
end)

RegisterNUICallback('searchCharacters', function(data, cb)
    ESX.TriggerServerCallback('jobsystem:searchCharacters', function(result)
        cb(result or {})
    end, data.query)
end)

RegisterNUICallback('setCharacterJob', function(data, cb)
    ESX.TriggerServerCallback('jobsystem:setCharacterJob', function(success, message)
        cb({ success = success, message = message })
    end, data)
end)

RegisterNUICallback('getMyJob', function(_, cb)
    ESX.TriggerServerCallback('jobsystem:getMyJob', function(result)
        cb(result)
    end)
end)

RegisterNUICallback('getEmployees', function(_, cb)
    ESX.TriggerServerCallback('jobsystem:getEmployees', function(result)
        cb(result or {})
    end)
end)

RegisterNUICallback('manageEmployee', function(data, cb)
    ESX.TriggerServerCallback('jobsystem:manageEmployee', function(success, message)
        cb({ success = success, message = message })
    end, data)
end)

RegisterNUICallback('searchHireCandidates', function(data, cb)
    ESX.TriggerServerCallback('jobsystem:searchHireCandidates', function(result)
        cb(result or {})
    end, data.query)
end)

RegisterNUICallback('hireEmployee', function(data, cb)
    ESX.TriggerServerCallback('jobsystem:hireEmployee', function(success, message)
        cb({ success = success, message = message })
    end, data)
end)

RegisterNUICallback('saveJobSettings', function(data, cb)
    ESX.TriggerServerCallback('jobsystem:saveJobSettings', function(success, message)
        cb({ success = success, message = message })
    end, data)
end)

RegisterNUICallback('saveApplicationSettings', function(data, cb)
    ESX.TriggerServerCallback('jobsystem:saveApplicationSettings', function(success, message)
        cb({ success = success, message = message })
    end, data)
end)

RegisterNUICallback('saveAdminApplicationSettings', function(data, cb)
    ESX.TriggerServerCallback('jobsystem:saveAdminApplicationSettings', function(success, message)
        cb({ success = success, message = message })
    end, data)
end)

RegisterNUICallback('getAdminJobApplications', function(data, cb)
    ESX.TriggerServerCallback('jobsystem:getAdminJobApplications', function(result)
        cb(result or {})
    end, data.jobName)
end)

RegisterNUICallback('getJobApplications', function(_, cb)
    ESX.TriggerServerCallback('jobsystem:getJobApplications', function(result)
        cb(result or {})
    end)
end)

RegisterNUICallback('getApplicationThread', function(data, cb)
    ESX.TriggerServerCallback('jobsystem:getApplicationThread', function(result)
        cb(result)
    end, data.id)
end)

RegisterNUICallback('updateApplicationStatus', function(data, cb)
    ESX.TriggerServerCallback('jobsystem:updateApplicationStatus', function(success, message)
        cb({ success = success, message = message })
    end, data)
end)

RegisterNUICallback('sendApplicationMessage', function(data, cb)
    ESX.TriggerServerCallback('jobsystem:sendApplicationMessage', function(success, message)
        cb({ success = success, message = message })
    end, data)
end)

RegisterNUICallback('getJobCenterJobs', function(_, cb)
    ESX.TriggerServerCallback('jobsystem:getJobCenterJobs', function(result)
        cb(result)
    end)
end)

RegisterNUICallback('applyJobCenterJob', function(data, cb)
    ESX.TriggerServerCallback('jobsystem:applyJobCenterJob', function(success, message)
        cb({ success = success, message = message })
    end, data.jobName)
end)

RegisterNUICallback('getMyName', function(_, cb)
    ESX.TriggerServerCallback('jobsystem:getMyName', function(result)
        cb(result or '')
    end)
end)

RegisterNUICallback('getOpenApplicationJobs', function(_, cb)
    ESX.TriggerServerCallback('jobsystem:getOpenApplicationJobs', function(result)
        cb(result or {})
    end)
end)

RegisterNUICallback('submitApplication', function(data, cb)
    ESX.TriggerServerCallback('jobsystem:submitApplication', function(success, message)
        cb({ success = success, message = message })
    end, data)
end)

RegisterNUICallback('getMyApplications', function(_, cb)
    ESX.TriggerServerCallback('jobsystem:getMyApplications', function(result)
        cb(result or {})
    end)
end)

AddEventHandler('onResourceStop', function(resourceName)
    if resourceName == GetCurrentResourceName() and uiOpen then
        CloseUI()
    end
end)
RegisterNUICallback('getLocale', function(_, cb)
    cb(Locales[Config.Locale] or Locales.de)
end)
