﻿param($installPath, $toolsPath, $package, $project)

$project |
	Add-Paths "{
		'scalejs.statechart' : 'Scripts/scalejs.statechart-$($package.Version)'
	}" |
	Add-Shims "{
			'scalejs.statechart' : {
				deps : ['scalejs.linq']
			}
		}" |
	Add-ScalejsExtension 'scalejs.statechart' |
	Out-Null