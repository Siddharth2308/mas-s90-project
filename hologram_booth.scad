// Hologram booth for room 357A — Pepper's ghost, side-mounted TV.
// Units: cm.  Open in OpenSCAD and press F5 (preview) to see colors/transparency.
//
// Axes:  x = room width, y = room length, z = up.
//        y = 0 is the far wall behind the booth; the door end is y = room_l.
//        Visitors stand near the door and look toward -y.
//
// How the illusion works in this model:
//   TV (portrait, on the left, facing +x)  ->  glass (vertical, 45° in plan)
//   -> reflected toward the visitors.  The figure appears behind the glass,
//   as far behind it as the TV is in front of it (figure_gap).
//   Orange line = real light path, cyan line = where the eye "thinks" it comes from.

$fn = 24;
IN = 2.54;

/* [Room] */
room_w = 215;
room_l = 360;
room_h = 300;            // ceiling ~10 ft
door_w = 90;
door_open_deg = 70;

/* [Glass] */
glass_w_in = 24;         // horizontal edge
glass_h_in = 36;         // vertical edge (stand the sheet on its short side)
glass_bottom_in = 30.77;   // glass bottom edge = where the figure's feet are
glass_t = 0.6;

/* [TV] */
tv_diag_in = 55;
tv_pic_bottom_in = 20;   // height of the bottom of the picture (portrait stand)
tv_depth = 6;
tv_bezel = 1;

/* [Booth] */
figure_gap = 25;         // TV screen -> glass distance = figure distance behind glass
back_gap = 10;           // room wall -> back drape
backdrop_gap = 15;       // figure plane -> back drape
stand_d = 12;            // room for the TV stand behind the TV
hood_in = 84;
figure_h_in = 32;

/* [Visitor] */
visitor_y = 260;
visitor_h = 180;         // 5'11"
eye_z = 168;

/* [Display] */
show_walls = false;
show_drapes = true;
show_rays = true;
show_labels = true;

/* [Frame] */
frame = "pvc";           // [pvc, pipe_drape]  pvc = PVC cage + PVC glass stand, pipe_drape = rented uprights + T-slot

/* [PVC (inches, centerline to centerline)] */
pvc_od_in = 1.315;       // 1" Schedule 40
fit_in = 0.875;          // fitting center -> socket bottom. Measure one fitting and set this!
cage_w_in = 41.12;     // 100 cm rails
cage_d_in = 41.12;
cage_post_cc_in = 80.49; // bottom corner center -> top corner center
front_rail_lo_in = 26.03;  // fascia rails, kept just outside the viewing window
front_rail_hi_in = 69.12;
stand_w_in = 25.77;      // glass stand post spacing (glass width + room for the clips)
stand_leg_in = 5.9;        // foot leg cut length
saddle_in = 0.15;        // printed saddle under the glass
top_gap_in = 0.51;       // glass top -> top rail
cap_in = 0.2;            // end cap past the pipe end

// ---------- derived ----------
glass_w   = glass_w_in * IN;
glass_h   = glass_h_in * IN;
glass_bot = glass_bottom_in * IN;
glass_top = glass_bot + glass_h;
span      = glass_w / sqrt(2);                // plan footprint of the glass (x and y)

scr_long  = tv_diag_in * 16 / sqrt(337) * IN; // portrait picture height
scr_short = tv_diag_in *  9 / sqrt(337) * IN; // portrait picture width
tv_body_h = scr_long  + 2 * tv_bezel;
tv_body_w = scr_short + 2 * tv_bezel;
tv_pic_bot = tv_pic_bottom_in * IN;

booth_w = stand_d + tv_depth + figure_gap + span + 15;
left_x  = (room_w - booth_w) / 2;
right_x = left_x + booth_w;
back_y  = back_gap;
fig_y   = back_y + backdrop_gap;
gx      = left_x + stand_d + tv_depth + figure_gap;  // glass back-left end
gy      = fig_y + figure_gap;
tv_x    = gx - figure_gap;                           // TV screen plane
tv_yc   = gy + span / 2;
fig_h   = figure_h_in * IN;
fig_xc  = gx + span / 2;

// PVC cage: pipe centerlines. The back drape stays at back_y, just outside the back pipes.
PVC = frame == "pvc";
pr  = pvc_od_in * IN / 2;
cage_w = cage_w_in * IN;
cage_d = cage_d_in * IN;
cx0 = (left_x + right_x - cage_w) / 2;
cx1 = cx0 + cage_w;
cy0 = back_y - pr;
cy1 = cy0 + cage_d;
cz0 = pr;
cz1 = cz0 + cage_post_cc_in * IN;
rail_lo = front_rail_lo_in * IN;
rail_hi = front_rail_hi_in * IN;

// outer faces of the booth (drapes / fascia go here)
ox0     = PVC ? cx0 - pr : left_x;
ox1     = PVC ? cx1 + pr : right_x;
front_y = PVC ? cy1 + pr : tv_yc + tv_body_w / 2 + 4;
hood_z  = PVC ? cz1 + pr : hood_in * IN;

// PVC glass stand: in the glass plane, centered on the glass
dir  = [1, 1] / sqrt(2);                 // along the glass (plan)
nrm  = [-1, 1] / sqrt(2);                // across the glass (plan)
gc   = [gx + span / 2, gy + span / 2];
sp   = [gc - dir * stand_w_in * IN / 2, gc + dir * stand_w_in * IN / 2];  // post positions
sz_b = glass_bot - pr - saddle_in * IN;  // bottom rail center
sz_t = glass_top + pr + top_gap_in * IN; // top rail center
leg_reach = (fit_in + stand_leg_in + cap_in) * IN;

win_x0 = gx - 4;               // window = open part of the front fascia
win_z0 = glass_bot - 4;
win_z1 = glass_top + 4;

echo(str("Booth footprint: ", round(ox1 - ox0), " x ", round(front_y - back_y + 0.5), " cm, height ", round(hood_z), " cm"));
echo(str("Glass ", glass_w_in, "x", glass_h_in, " in, bottom at ", glass_bottom_in, " in; figure up to ~", figure_h_in, " in tall"));
echo(str("Viewing distance (visitor to front): ", round(visitor_y - front_y), " cm"));

// ---------- PVC cut list + checks ----------
function cut(cc_in) = round((cc_in - 2 * fit_in) * 100) / 100;   // inches
r_in = pvc_od_in / 2;
cuts = [   // [name, qty, cut length in]
    ["cage back posts",            2, cut(cage_post_cc_in)],
    ["cage rails, front/back",     4, cut(cage_w_in)],
    ["cage rails, sides",          4, cut(cage_d_in)],
    ["cage fascia rails",          2, cut(cage_w_in)],
    ["front posts, bottom",        2, cut(front_rail_lo_in - r_in)],
    ["front posts, middle",        2, cut(front_rail_hi_in - front_rail_lo_in)],
    ["front posts, top",           2, cut(r_in + cage_post_cc_in - front_rail_hi_in)],
    ["glass stand rails",          2, cut(stand_w_in)],
    ["glass stand posts, lower",   2, cut((sz_b - pr) / IN)],
    ["glass stand posts, upper",   2, cut((sz_t - sz_b) / IN)],
    ["glass stand feet",           4, stand_leg_in],
];
function total(i = 0) = i == len(cuts) ? 0 : cuts[i][1] * cuts[i][2] + total(i + 1);

module checks() {
    // feet must stay inside the cage and clear of the pedestal
    for (p = sp, s = [-1, 1]) {
        t = p + nrm * s * leg_reach;
        if (t[0] < cx0 + pr || t[0] > cx1 - pr || t[1] < cy0 + pr || t[1] > cy1 - pr)
            echo(str("WARNING: glass stand foot hits the cage at ", t));
        if (t[0] > fig_xc - 22.5 && t[0] < fig_xc + 22.5 && t[1] < fig_y + 10)
            echo(str("WARNING: glass stand foot hits the pedestal at ", t));
    }
    if (rail_lo + pr > win_z0 || rail_hi - pr < win_z1)
        echo("WARNING: a fascia rail shows in the viewing window");
    if (front_y - pr - (tv_yc + tv_body_w / 2) < 0.5)
        echo("WARNING: TV touches the front of the cage");
}

if (PVC) {
    echo("PVC CUT LIST (inches; pipe length = center-to-center - 2 x fit_in):");
    for (c = cuts) echo(str("  ", c[1], " x ", c[2], "  ", c[0]));
    echo(str("  total ", round(total()), " in = at least ", ceil(total() / 120), " x 10 ft sticks (plus offcuts)"));
    echo("PVC FITTINGS: 8 x 3-way corner, 8 x tee, 2 x 90 elbow, 4 x end cap");
    checks();
}

// ---------- helpers ----------
module line3(a, b, r = 0.6) hull() { translate(a) sphere(r, $fn = 8); translate(b) sphere(r, $fn = 8); }
module ext(a, b) hull() { translate(a) cube(2.54, center = true); translate(b) cube(2.54, center = true); } // 1" T-slot

module pipe(a, b) {   // PVC pipe, fitting center to fitting center
    v = b - a;
    L = norm(v);
    color("WhiteSmoke") translate(a) rotate([0, acos(v[2] / L), atan2(v[1], v[0])]) cylinder(r = pr, h = L, $fn = 16);
}
module fitting(p) color([0.1, 0.1, 0.1]) translate(p) sphere(pr * 1.45, $fn = 16);

module floor_label(t, p, rot = 0, sz = 6)
    color("Black") translate([p[0], p[1], 0.2]) rotate([0, 0, rot])
        linear_extrude(0.3) text(t, size = sz, halign = "center", valign = "center");

module front_label(t, p, sz = 5)   // readable from the visitors' side (+y)
    color("Black") translate(p) rotate([90, 0, 180])
        linear_extrude(0.3) text(t, size = sz, halign = "center", valign = "center");

// Flat jester silhouette, feet at origin, height h. Raised arm shows the mirror flip.
module jester2d(h) {
    s = h / 102;
    scale([s, s]) {
        translate([-9, 0]) square([7, 45]);
        translate([2, 0])  square([7, 45]);
        translate([-14, 45]) square([28, 32]);
        translate([-20, 48]) square([6, 28]);
        translate([14, 70]) rotate(-30) square([6, 26]);
        translate([0, 84]) circle(8);
        polygon([[-8, 88], [-20, 99], [-2, 92], [2, 92], [20, 99], [8, 88]]);
        translate([-20, 99]) circle(2.5);
        translate([20, 99])  circle(2.5);
    }
}

module person(h) {   // simple visitor, feet at origin
    s = h / 180;
    color("SteelBlue") {
        for (dx = [-9, 9]) translate([dx * s, 0, 0]) cylinder(r = 6 * s, h = 85 * s);
        translate([0, 0, 85 * s]) scale([1, 0.55, 1]) cylinder(r1 = 17 * s, r2 = 21 * s, h = 67 * s);
        for (dx = [-24, 24]) translate([dx * s, 0, 88 * s]) cylinder(r = 4.5 * s, h = 62 * s);
    }
    color("Tan") translate([0, 0, 167 * s]) sphere(12 * s);
}

// ---------- room ----------
module room() {
    color("Gainsboro") translate([0, 0, -1]) cube([room_w, room_l, 1]);
    // walls: full height if show_walls, otherwise a low outline so you can see in
    color(show_walls ? [0.75, 0.75, 0.8, 0.15] : [0.55, 0.55, 0.6]) difference() {
        translate([-5, -5, 0]) cube([room_w + 10, room_l + 10, show_walls ? room_h : 25]);
        translate([0, 0, -1]) cube([room_w, room_l, room_h + 2]);
        translate([room_w - 1, room_l - door_w, -1]) cube([7, door_w, 212]);
    }
    // door: hinge at the corner, swings into the room
    color("Peru") translate([room_w, room_l, 0]) rotate([0, 0, -door_open_deg])
        translate([-4, -door_w, 0]) cube([4, door_w, 210]);
    color("Peru") translate([room_w, room_l, 0.1]) rotate([0, 0, 270 - door_open_deg])
        rotate_extrude(angle = door_open_deg, $fn = 64) translate([door_w - 1, 0]) square([1, 0.3]);
}

// ---------- booth ----------
module tv() {
    color("Black") translate([tv_x - tv_depth, tv_yc - tv_body_w / 2, tv_pic_bot - tv_bezel])
        cube([tv_depth, tv_body_w, tv_body_h]);
    color([0.12, 0.12, 0.3]) translate([tv_x - 0.1, tv_yc - scr_short / 2, tv_pic_bot])
        cube([0.2, scr_short, scr_long]);
    // what the screen shows (rest of the screen stays black)
    color("Magenta") translate([tv_x + 0.05, tv_yc, glass_bot]) rotate([90, 0, 90])
        linear_extrude(0.3) jester2d(fig_h);
    // rolling portrait stand
    color("DimGray") {
        px = tv_x - tv_depth - 4;
        translate([px, tv_yc, 0]) cylinder(r = 2.5, h = tv_pic_bot + scr_long * 0.6);
        translate([px - 4, tv_yc - 35, 0]) cube([8, 70, 3]);
        for (dy = [-33, 33]) translate([px - 4, tv_yc + dy - 3, 0]) cube([tv_depth + 12, 6, 3]);
    }
}

module glass() {
    color([0.6, 0.85, 1, 0.35]) translate([gx, gy, glass_bot]) rotate([0, 0, 45])
        translate([0, -glass_t / 2, 0]) cube([glass_w, glass_t, glass_h]);
}

module glass_frame() {   // 1" T-slot: two posts, two rails, two feet
    d = [1, 1] / sqrt(2);
    n = [-1, 1] / sqrt(2);
    p0 = [gx, gy] - d * 1.8;
    p1 = [gx + span, gy + span] + d * 1.8;
    color("Silver") {
        for (p = [p0, p1]) {
            ext([p[0], p[1], 1.27], [p[0], p[1], glass_top + 1.27]);
            ext([p[0] - n[0] * 12, p[1] - n[1] * 12, 1.27], [p[0] + n[0] * 12, p[1] + n[1] * 12, 1.27]);
        }
        for (z = [glass_bot - 1.3, glass_top + 1.3])
            ext([p0[0], p0[1], z], [p1[0], p1[1], z]);
    }
}

module pedestal() {
    color("DimGray") translate([fig_xc - 22.5, back_y, 0]) cube([45, fig_y + 10 - back_y, glass_bot]);
}

module virtual_figure() {
    color([0, 1, 1, 0.55]) translate([fig_xc, fig_y, glass_bot]) rotate([90, 0, 0])
        linear_extrude(1, center = true) jester2d(fig_h);
}

module enclosure() {
    if (show_drapes) color([0.15, 0.15, 0.15, 0.25]) {
        translate([ox0, back_y - 0.5, 0]) cube([ox1 - ox0, 0.5, hood_z]);              // back drape
        translate([ox0 - 0.5, back_y, 0]) cube([0.5, front_y - back_y, hood_z]);        // left drape
        translate([ox1, back_y, 0]) cube([0.5, front_y - back_y, hood_z]);              // right drape
        translate([ox0, back_y, hood_z]) cube([ox1 - ox0, front_y - back_y, 0.5]);      // hood
    }
    color([0.05, 0.05, 0.05, 0.6]) {   // front fascia (black foam board)
        translate([ox0, front_y, 0]) cube([win_x0 - ox0, 0.5, hood_z]);                 // hides the TV
        translate([win_x0, front_y, 0]) cube([ox1 - win_x0, 0.5, win_z0]);              // skirt
        translate([win_x0, front_y, win_z1]) cube([ox1 - win_x0, 0.5, hood_z - win_z1]); // header
        translate([win_x0 - 0.5, gy + span + 2, win_z0])                                 // side baffle
            cube([0.5, front_y - (gy + span + 2), win_z1 - win_z0]);
    }
    if (!PVC) color("Gray") for (x = [left_x, right_x], y = [back_y, front_y])
        translate([x, y, 0]) cylinder(r = 1.5, h = hood_z, $fn = 12);   // pipe-and-drape uprights
}

module pvc_cage() {   // 40 x 40 box + two fascia rails on the front
    for (x = [cx0, cx1], y = [cy0, cy1]) {
        pipe([x, y, cz0], [x, y, cz1]);
        for (z = [cz0, cz1]) fitting([x, y, z]);                            // 3-way corners
    }
    for (z = [cz0, cz1]) {
        for (y = [cy0, cy1]) pipe([cx0, y, z], [cx1, y, z]);
        for (x = [cx0, cx1]) pipe([x, cy0, z], [x, cy1, z]);
    }
    for (z = [rail_lo, rail_hi]) {
        pipe([cx0, cy1, z], [cx1, cy1, z]);
        for (x = [cx0, cx1]) fitting([x, cy1, z]);                         // tees
    }
}

module pvc_glass_stand() {   // free-standing at 45 deg; zip-tie the top to the cage
    for (p = sp) {
        pipe([p[0], p[1], pr], [p[0], p[1], sz_t]);
        for (z = [pr, sz_b, sz_t]) fitting([p[0], p[1], z]);              // foot tee, rail tee, elbow
        for (s = [-1, 1]) {                                                // feet + end caps
            t = p + nrm * s * leg_reach;
            pipe([p[0], p[1], pr], [t[0], t[1], pr]);
            color([0.1, 0.1, 0.1]) translate([t[0], t[1], pr]) sphere(pr * 1.2, $fn = 12);
        }
    }
    for (z = [sz_b, sz_t]) pipe([sp[0][0], sp[0][1], z], [sp[1][0], sp[1][1], z]);
    // 3D-printed saddles (under the glass) and top clips
    color("Orange") for (f = [0.15, 0.5, 0.85]) {
        q = gc + dir * (f - 0.5) * glass_w;
        translate([q[0], q[1], sz_b + pr]) rotate([0, 0, 45]) translate([-2, -1.5, 0])
            cube([4, 3, glass_bot - sz_b - pr + 1.5]);
        translate([q[0], q[1], glass_top - 1.5]) rotate([0, 0, 45]) translate([-2, -1.5, 0])
            cube([4, 3, sz_t - glass_top + 1.5]);
    }
}

module rays() {
    E = [room_w / 2, visitor_y, eye_z];
    S = [tv_x, tv_yc, glass_bot + fig_h * 0.6];   // a point on the TV
    V = [fig_xc, fig_y, S[2]];                    // its virtual image
    function f(P) = (P[0] - gx) - (P[1] - gy);    // signed side of the glass plane
    t = f(E) / (f(E) - f(V));
    R = E + t * (V - E);                          // where the ray hits the glass
    color("Orange") { line3(S, R); line3(R, E); }
    color([0, 1, 1, 0.6]) line3(R, V, 0.35);
}

module labels() {
    floor_label("ROOM 357A  215 x 360 cm", [room_w / 2 - 25, room_l - 110], 0, 7);
    floor_label("DOOR", [room_w - 25, room_l - door_w / 2 - 10], 90);
    floor_label("VISITORS", [room_w / 2, visitor_y - 40], 0, 8);
    floor_label("55in TV, portrait", [ox0 - 12, tv_yc], 90, 5);
    floor_label(str("GLASS ", glass_w_in, "x", glass_h_in, "in @45"), [ox1 + 14, gy + span / 2], 90, 5);
    front_label("virtual figure", [fig_xc, fig_y, glass_bot + fig_h + 12], 4);
    front_label(str("booth ~", round(ox1 - ox0), " x ", round(front_y - back_y), " cm"), [room_w / 2, front_y + 1, hood_z + 12], 6);
}

// ---------- scene ----------
room();
tv();
glass();
if (PVC) { pvc_cage(); pvc_glass_stand(); } else glass_frame();
pedestal();
virtual_figure();
enclosure();
translate([room_w / 2, visitor_y, 0]) person(visitor_h);
if (show_rays) rays();
if (show_labels) labels();

// initial camera: front-right of the booth, looking in (drag to orbit)
$vpt = [room_w / 2, 90, 100];
$vpr = [75, 0, 140];
$vpd = 450;
