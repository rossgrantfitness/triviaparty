class_name Accessories
extends RefCounted
## Builds the hats and things players pick on their phone, from simple shapes,
## in the game palette. Each one is a Node3D to attach to an animal's head node
## (origin at the neck; +Y up, +Z toward the camera).


static func build(kind: String, hat_y: float, eyes: Vector3) -> Node3D:
	var root: Node3D = Node3D.new()
	root.name = "accessory_" + kind
	match kind:
		"party_hat":
			var cone: MeshInstance3D = _cylinder(0.0, 0.15, 0.34, Look.ORANGE)
			cone.position = Vector3(0.06, hat_y + 0.15, 0)
			cone.rotation_degrees = Vector3(0, 0, -14)
			root.add_child(cone)
			var stripe: MeshInstance3D = _cylinder(0.105, 0.115, 0.05, Look.YELLOW)
			stripe.position = Vector3(0.045, hat_y + 0.08, 0)
			stripe.rotation_degrees = Vector3(0, 0, -14)
			root.add_child(stripe)
			var pom: MeshInstance3D = _sphere(0.05, Look.YELLOW)
			pom.position = Vector3(0.1, hat_y + 0.33, 0)
			root.add_child(pom)
		"headband":
			# A hachimaki with a red sun on the forehead.
			var band: MeshInstance3D = MeshInstance3D.new()
			var torus: TorusMesh = TorusMesh.new()
			torus.inner_radius = 0.33
			torus.outer_radius = 0.39
			band.mesh = torus
			band.scale = Vector3(1.15, 1.0, 1.0)
			band.position = Vector3(0, hat_y - 0.17, 0)
			band.material_override = _material(Look.WHITE)
			root.add_child(band)
			var sun: MeshInstance3D = _cylinder(0.05, 0.05, 0.02, Look.RED)
			sun.rotation_degrees = Vector3(90, 0, 0)
			sun.position = Vector3(0, hat_y - 0.17, 0.39)
			root.add_child(sun)
			for side: float in [-1.0, 1.0]:
				var tail: MeshInstance3D = _box(Vector3(0.05, 0.16, 0.02), Look.WHITE)
				tail.position = Vector3(side * 0.08, hat_y - 0.26, -0.38)
				tail.rotation_degrees = Vector3(0, 0, side * 25)
				root.add_child(tail)
		"bow":
			for side: float in [-1.0, 1.0]:
				var loop: MeshInstance3D = _sphere(0.08, Look.RED)
				loop.scale = Vector3(1.0, 0.7, 0.45)
				loop.position = Vector3(0.22 + side * 0.08, hat_y - 0.02, 0.08)
				root.add_child(loop)
			var knot: MeshInstance3D = _sphere(0.035, Look.RED)
			knot.position = Vector3(0.22, hat_y - 0.02, 0.1)
			root.add_child(knot)
		"crown":
			var ring: MeshInstance3D = _cylinder(0.16, 0.15, 0.12, Look.YELLOW)
			ring.position = Vector3(0, hat_y + 0.02, 0)
			root.add_child(ring)
			for i: int in 5:
				var angle: float = i * TAU / 5.0
				var point: MeshInstance3D = _cylinder(0.0, 0.04, 0.09, Look.YELLOW)
				point.position = Vector3(cos(angle) * 0.14, hat_y + 0.12, sin(angle) * 0.14)
				root.add_child(point)
			var gem: MeshInstance3D = _sphere(0.03, Look.RED)
			gem.position = Vector3(0, hat_y + 0.02, 0.16)
			root.add_child(gem)
		"top_hat":
			var brim: MeshInstance3D = _cylinder(0.25, 0.25, 0.03, Look.BLACK)
			brim.position = Vector3(0, hat_y - 0.02, 0)
			root.add_child(brim)
			var crown: MeshInstance3D = _cylinder(0.15, 0.15, 0.3, Look.BLACK)
			crown.position = Vector3(0, hat_y + 0.14, 0)
			root.add_child(crown)
			var band: MeshInstance3D = _cylinder(0.153, 0.153, 0.05, Look.ORANGE)
			band.position = Vector3(0, hat_y + 0.03, 0)
			root.add_child(band)
		"flower":
			var center: MeshInstance3D = _sphere(0.04, Look.YELLOW)
			center.position = Vector3(0.24, hat_y - 0.04, 0.12)
			root.add_child(center)
			for i: int in 5:
				var angle: float = i * TAU / 5.0
				var petal: MeshInstance3D = _sphere(0.045, Color("e88fb0"))
				petal.scale = Vector3(1, 1, 0.5)
				petal.position = center.position + Vector3(cos(angle) * 0.065, sin(angle) * 0.065, 0)
				root.add_child(petal)
		"glasses":
			for side: float in [-1.0, 1.0]:
				var lens: MeshInstance3D = MeshInstance3D.new()
				var torus: TorusMesh = TorusMesh.new()
				torus.inner_radius = 0.06
				torus.outer_radius = 0.08
				lens.mesh = torus
				lens.rotation_degrees = Vector3(90, 0, 0)
				lens.position = Vector3(side * 0.15 + (side * 0.04 if eyes.y > 0.4 else 0.0), eyes.y, eyes.z + 0.03)
				lens.material_override = _material(Look.BLACK)
				root.add_child(lens)
			var bridge: MeshInstance3D = _box(Vector3(0.1, 0.02, 0.02), Look.BLACK)
			bridge.position = Vector3(0, eyes.y + 0.01, eyes.z + 0.04)
			root.add_child(bridge)
		_:
			root.queue_free()
			return null
	return root


static func _material(color: Color) -> StandardMaterial3D:
	var mat: StandardMaterial3D = StandardMaterial3D.new()
	mat.albedo_color = color
	mat.roughness = 0.5
	return mat


static func _cylinder(top: float, bottom: float, height: float, color: Color) -> MeshInstance3D:
	var node: MeshInstance3D = MeshInstance3D.new()
	var mesh: CylinderMesh = CylinderMesh.new()
	mesh.top_radius = top
	mesh.bottom_radius = bottom
	mesh.height = height
	mesh.radial_segments = 20
	node.mesh = mesh
	node.material_override = _material(color)
	return node


static func _sphere(radius: float, color: Color) -> MeshInstance3D:
	var node: MeshInstance3D = MeshInstance3D.new()
	var mesh: SphereMesh = SphereMesh.new()
	mesh.radius = radius
	mesh.height = radius * 2.0
	mesh.radial_segments = 16
	mesh.rings = 8
	node.mesh = mesh
	node.material_override = _material(color)
	return node


static func _box(size: Vector3, color: Color) -> MeshInstance3D:
	var node: MeshInstance3D = MeshInstance3D.new()
	var mesh: BoxMesh = BoxMesh.new()
	mesh.size = size
	node.mesh = mesh
	node.material_override = _material(color)
	return node
