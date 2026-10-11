Config = {}

Config.Locale = 'en'

Config.AdminGroups = { 'admin', 'superadmin' }

Config.UnemployedJob = 'unemployed'
Config.UnemployedGrade = 0

Config.Webhook = nil

Config.ApplicationSubjectMaxLength = 100
Config.ApplicationBodyMaxLength    = 1500
Config.ApplicationMessageMaxLength = 1000

Config.JobManagerGrades = {
	['admin']    = 0,
    ['police']    = 6,
	['government']    = 7,
}

Config.HireableFromJobs = { 'unemployed' }

Config.JobCenter = {
    coords  = vector3(-1081.9158, -247.3559, 37.7633),
    heading = 33.5915,

    
    drawDistance = 12.0,
    
    interactionDistance = 1.5,

    marker = {
        type  = 1,
        size  = vector3(1.2, 1.2, 0.6),
        color = { r = 59, g = 130, b = 246, a = 120 },
    },

    
    interactionControl = 38,

    blip = {
        enabled = true,
        sprite  = 407,
        color   = 3,
        scale   = 0.8,
    },
}